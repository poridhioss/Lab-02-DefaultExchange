const amqp = require('amqplib');
const config = require('./config');
const { getTaskProcessor } = require('./task-types');

let connection = null;
let channel = null;

// Worker identification
const workerId = `worker_${process.pid}_${Math.random().toString(36).substr(2, 5)}`;
let processedCount = 0;
let failedCount = 0;

/**
 * Initialize RabbitMQ connection and start consuming
 */
async function initWorker() {
  try {
    console.log(`👷 ${workerId} - Starting...`);
    
    // Connect to RabbitMQ
    connection = await amqp.connect(config.rabbitmq.url);
    
    connection.on('error', (err) => {
      console.error(`❌ ${workerId} - Connection error:`, err.message);
    });
    
    connection.on('close', () => {
      console.log(`⚠️  ${workerId} - Connection closed. Reconnecting...`);
      setTimeout(initWorker, 5000);
    });

    // Create channel
    channel = await connection.createChannel();
    
    console.log(`✅ ${workerId} - Connected to RabbitMQ`);

    // Declare the queue (idempotent operation)
    await channel.assertQueue(
      config.rabbitmq.queues.tasks,
      config.rabbitmq.queueOptions
    );

    // CRITICAL: Set prefetch count for fair dispatch
    // This ensures each worker gets only 1 message at a time
    // Workers don't get a new message until they acknowledge the current one
    await channel.prefetch(config.rabbitmq.prefetchCount);
    
    console.log(`📊 ${workerId} - Prefetch count set to ${config.rabbitmq.prefetchCount}`);
    console.log(`🎯 ${workerId} - Waiting for tasks from '${config.rabbitmq.queues.tasks}'...`);

    // Start consuming messages
    channel.consume(
      config.rabbitmq.queues.tasks,
      handleTask,
      config.rabbitmq.consumerOptions // noAck: false (manual ack)
    );

    // Display stats every 30 seconds
    setInterval(displayStats, 30000);
  } catch (error) {
    console.error(`❌ ${workerId} - Failed to initialize:`, error.message);
    process.exit(1);
  }
}

/**
 * Handle incoming task message
 * This function processes each message and acknowledges it
 */
async function handleTask(msg) {
  if (msg === null) {
    console.log(`⚠️  ${workerId} - Consumer cancelled`);
    return;
  }

  const startTime = Date.now();
  
  try {
    // Parse task from message
    const task = JSON.parse(msg.content.toString());
    
    console.log(`\n📨 ${workerId} - Received task: ${task.id}`);
    console.log(`   Type: ${task.type}`);
    console.log(`   Created: ${task.createdAt}`);

    // Get task processor
    const processor = getTaskProcessor(task.type);
    
    if (!processor) {
      throw new Error(`Unknown task type: ${task.type}`);
    }

    console.log(`⚙️  ${workerId} - Processing ${task.type}...`);

    // Execute task processor
    const result = await processor.process(task.data);

    const duration = Date.now() - startTime;
    
    console.log(`✅ ${workerId} - Task completed: ${task.id}`);
    console.log(`   Duration: ${duration}ms`);
    console.log(`   Result:`, result);

    // IMPORTANT: Acknowledge message after successful processing
    // This removes the message from the queue
    channel.ack(msg);
    
    processedCount++;

  } catch (error) {
    const duration = Date.now() - startTime;
    
    console.error(`❌ ${workerId} - Task failed after ${duration}ms`);
    console.error(`   Error: ${error.message}`);

    // IMPORTANT: Negative acknowledgment
    // requeue: true - Put message back in queue for retry
    // requeue: false - Send to dead letter exchange (if configured)
    channel.nack(msg, false, true);
    
    failedCount++;
  }
}

/**
 * Display worker statistics
 */
function displayStats() {
  console.log(`\n📊 ${workerId} - Statistics:`);
  console.log(`   Processed: ${processedCount}`);
  console.log(`   Failed: ${failedCount}`);
  console.log(`   Success Rate: ${processedCount > 0 ? ((processedCount / (processedCount + failedCount)) * 100).toFixed(2) : 0}%`);
}

// ============ GRACEFUL SHUTDOWN ============

async function shutdown() {
  console.log(`\n🛑 ${workerId} - Shutting down gracefully...`);
  
  displayStats();
  
  if (channel) {
    // Cancel consumer (stop receiving new messages)
    await channel.cancel();
    await channel.close();
  }
  
  if (connection) {
    await connection.close();
  }
  
  console.log(`👋 ${workerId} - Shutdown complete`);
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ============ START WORKER ============

initWorker();
