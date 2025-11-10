const express = require('express');
const amqp = require('amqplib');
const config = require('./config');
const { getAvailableTaskTypes } = require('./task-types');

const app = express();
app.use(express.json());

let connection = null;
let channel = null;

/**
 * Initialize RabbitMQ connection and channel
 * This establishes connection and declares the task queue
 */
async function initRabbitMQ() {
  try {
    console.log('Connecting to RabbitMQ...');
    
    // Establish connection to RabbitMQ server
    connection = await amqp.connect(config.rabbitmq.url);
    
    // Handle connection errors
    connection.on('error', (err) => {
      console.error('Connection error:', err.message);
    });
    
    connection.on('close', () => {
      console.log('Connection closed. Reconnecting...');
      setTimeout(initRabbitMQ, 5000);
    });

    // Create a channel for communication
    channel = await connection.createChannel();
    
    console.log('Connected to RabbitMQ');

    // Declare the task queue with durable option
    // This ensures the queue persists across RabbitMQ restarts
    await channel.assertQueue(
      config.rabbitmq.queues.tasks,
      config.rabbitmq.queueOptions
    );
    
    console.log(`📋 Queue '${config.rabbitmq.queues.tasks}' is ready`);
  } catch (error) {
    console.error('Failed to initialize RabbitMQ:', error.message);
    process.exit(1);
  }
}

/**
 * Publish task to the default exchange
 * The default exchange routes messages directly to queues by queue name
 */
async function publishTask(taskType, taskData) {
  try {
    const task = {
      id: generateTaskId(),
      type: taskType,
      data: taskData,
      createdAt: new Date().toISOString(),
      attempts: 0,
    };

    // Convert task object to Buffer
    const message = Buffer.from(JSON.stringify(task));

    // Publish to default exchange (empty string '')
    // Routing key = queue name (this is how default exchange works!)
    const published = channel.sendToQueue(
      config.rabbitmq.queues.tasks, // This becomes the routing key
      message,
      config.rabbitmq.publishOptions // Persistent message option
    );

    if (published) {
      console.log(`Task published: ${task.id} (${taskType})`);
      return { success: true, taskId: task.id };
    } else {
      console.log('Message buffer full, waiting...');
      return { success: false, error: 'Buffer full' };
    }
  } catch (error) {
    console.error('Failed to publish task:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Generate unique task ID
 */
function generateTaskId() {
  return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// ============ API ENDPOINTS ============

/**
 * POST /api/tasks
 * Submit a new task to the queue
 * 
 * Request body:
 * {
 *   "type": "EMAIL",
 *   "data": {
 *     "recipient": "user@example.com",
 *     "subject": "Welcome!"
 *   }
 * }
 */
app.post('/api/tasks', async (req, res) => {
  const { type, data } = req.body;

  // Validate task type
  if (!type || !getAvailableTaskTypes().includes(type)) {
    return res.status(400).json({
      error: 'Invalid task type',
      availableTypes: getAvailableTaskTypes(),
    });
  }

  // Validate task data
  if (!data || typeof data !== 'object') {
    return res.status(400).json({
      error: 'Task data is required and must be an object',
    });
  }

  // Publish task
  const result = await publishTask(type, data);

  if (result.success) {
    res.status(201).json({
      message: 'Task queued successfully',
      taskId: result.taskId,
      type,
    });
  } else {
    res.status(500).json({
      error: 'Failed to queue task',
      details: result.error,
    });
  }
});

/**
 * POST /api/tasks/batch
 * Submit multiple tasks at once
 * 
 * Request body:
 * {
 *   "tasks": [
 *     { "type": "EMAIL", "data": {...} },
 *     { "type": "IMAGE_PROCESSING", "data": {...} }
 *   ]
 * }
 */
app.post('/api/tasks/batch', async (req, res) => {
  const { tasks } = req.body;

  if (!Array.isArray(tasks) || tasks.length === 0) {
    return res.status(400).json({
      error: 'tasks must be a non-empty array',
    });
  }

  const results = [];
  
  for (const task of tasks) {
    if (!getAvailableTaskTypes().includes(task.type)) {
      results.push({
        type: task.type,
        success: false,
        error: 'Invalid task type',
      });
      continue;
    }

    const result = await publishTask(task.type, task.data);
    results.push({
      type: task.type,
      success: result.success,
      taskId: result.taskId,
      error: result.error,
    });
  }

  const successCount = results.filter((r) => r.success).length;

  res.status(200).json({
    message: `Queued ${successCount}/${tasks.length} tasks`,
    results,
  });
});

/**
 * GET /api/tasks/types
 * Get list of available task types
 */
app.get('/api/tasks/types', (req, res) => {
  const types = getAvailableTaskTypes();
  res.json({
    availableTypes: types,
    count: types.length,
  });
});

/**
 * GET /health
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    rabbitmq: channel ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
  });
});

// ============ SERVER STARTUP ============

async function start() {
  try {
    await initRabbitMQ();

    app.listen(config.api.port, () => {
      console.log(`Task Producer API running on port ${config.api.port}`);
      console.log(`Available endpoints:`);
      console.log(`   POST   http://localhost:${config.api.port}/api/tasks`);
      console.log(`   POST   http://localhost:${config.api.port}/api/tasks/batch`);
      console.log(`   GET    http://localhost:${config.api.port}/api/tasks/types`);
      console.log(`   GET    http://localhost:${config.api.port}/health`);
    });
  } catch (error) {
    console.error('Failed to start:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down gracefully...');
  if (channel) await channel.close();
  if (connection) await connection.close();
  process.exit(0);
});

start();
