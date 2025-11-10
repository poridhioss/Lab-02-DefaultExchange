# Lab 3: Default Exchange Implementation - Detailed Guide

The default exchange (also called the nameless exchange) is a pre-declared direct exchange with an empty string as its name. It has a special property: every queue is automatically bound to it with a routing key equal to the queue name. This makes it perfect for simple point-to-point messaging patterns.

Theory: Understanding Default Exchange
What is the Default Exchange?
The Default Exchange (also called the Nameless Exchange or Empty String Exchange) is a special built-in exchange in RabbitMQ with unique characteristics:
Key Characteristics:

Name: Empty string ""
Type: Direct exchange
Pre-declared: Always exists, cannot be deleted
Implicit Binding: Every queue is automatically bound to it with the queue name as the routing key

Publishing to Default Exchange


```bash
// When you publish to default exchange
channel.sendToQueue('task-queue', messageBuffer, options);

// This is equivalent to:
channel.publish('', 'task-queue', messageBuffer, options);
//               ^^   ^^^^^^^^^^^
//               |    routing key = queue name
//               empty string = default exchange
```

### Key Concepts

#### 1. Point-to-Point Messaging
```
Producer → Queue → Consumer
```

- One message goes to exactly one consumer
- Perfect for work distribution
- Round-robin load balancing

#### 2. Work Queue Pattern
```
Producer → Task Queue → Consumer 1 (processing)
                     → Consumer 2 (processing)
                     → Consumer 3 (idle)
```

**Benefits:**
- Distribute time-consuming tasks
- Scale workers independently
- Avoid resource exhaustion
- Handle traffic spikes

#### 3. Fair Dispatch (Prefetch)

**Without Prefetch:**
```
Worker 1: [TASK][TASK][TASK][TASK][TASK] (overloaded)
Worker 2: [TASK]                         (idle)
Worker 3: [TASK]                         (idle)
```

**With Prefetch = 1:**
```
Worker 1: [TASK] (processing)
Worker 2: [TASK] (processing)
Worker 3: [TASK] (processing)
Queue:    [TASK][TASK] (waiting)
```

## 🏗️ Project Structure

```
lab3-task-queue/
├── package.json
├── config.js
├── task-types.js
├── task-producer.js
├── worker.js
└── load-tester.js
```

---

## 📦 Step 1: Initialize Project

```bash
mkdir lab3-task-queue
cd lab3-task-queue
npm init -y
npm install amqplib express dotenv
```

---

## 📝 Step 2: Create Configuration File

**File: `config.js`**

```javascript
// Configuration for RabbitMQ connection and task queue settings
module.exports = {
  // RabbitMQ connection URL
  rabbitmq: {
    url: process.env.RABBITMQ_URL || 'amqp://localhost',
    // Queue configuration
    queues: {
      tasks: 'task_queue', // Main task queue name
    },
    // Options for queue declaration
    queueOptions: {
      durable: true, // Queue survives broker restart
    },
    // Options for message publishing
    publishOptions: {
      persistent: true, // Messages survive broker restart
    },
    // Consumer configuration
    consumerOptions: {
      noAck: false, // Manual acknowledgment required
    },
    // Prefetch configuration for fair dispatch
    prefetchCount: 1, // Process one message at a time
  },
  // Task producer API configuration
  api: {
    port: process.env.PORT || 3000,
  },
};
```

**Key Configuration Explained:**

- **durable: true** - The queue persists even if RabbitMQ restarts
- **persistent: true** - Messages are written to disk, surviving restarts
- **noAck: false** - Workers must manually acknowledge message processing
- **prefetchCount: 1** - Ensures fair dispatch; workers get one message at a time

---

## 📝 Step 3: Define Task Types

**File: `task-types.js`**

```javascript
/**
 * Task type definitions with processing logic
 * Each task type has a name, processor function, and estimated duration
 */

const taskTypes = {
  EMAIL: {
    name: 'EMAIL',
    description: 'Send email notification',
    // Simulate email sending with random delay
    process: async (data) => {
      const delay = Math.random() * 2000 + 1000; // 1-3 seconds
      await sleep(delay);
      return {
        status: 'sent',
        recipient: data.recipient,
        subject: data.subject,
        sentAt: new Date().toISOString(),
      };
    },
  },

  IMAGE_PROCESSING: {
    name: 'IMAGE_PROCESSING',
    description: 'Process and resize images',
    // Simulate image processing with longer delay
    process: async (data) => {
      const delay = Math.random() * 5000 + 3000; // 3-8 seconds
      await sleep(delay);
      return {
        status: 'processed',
        imageUrl: data.imageUrl,
        dimensions: data.dimensions || '800x600',
        processedAt: new Date().toISOString(),
      };
    },
  },

  REPORT_GENERATION: {
    name: 'REPORT_GENERATION',
    description: 'Generate PDF reports',
    // Simulate report generation with variable delay
    process: async (data) => {
      const delay = Math.random() * 4000 + 2000; // 2-6 seconds
      await sleep(delay);
      return {
        status: 'generated',
        reportType: data.reportType,
        recordCount: data.recordCount || 0,
        generatedAt: new Date().toISOString(),
      };
    },
  },

  DATA_BACKUP: {
    name: 'DATA_BACKUP',
    description: 'Backup database',
    // Simulate backup with longer processing time
    process: async (data) => {
      const delay = Math.random() * 6000 + 4000; // 4-10 seconds
      await sleep(delay);
      return {
        status: 'completed',
        database: data.database,
        size: data.size || 'unknown',
        backupLocation: `/backups/${Date.now()}.sql`,
        completedAt: new Date().toISOString(),
      };
    },
  },
};

// Helper function to simulate async work
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get task processor by type
 * @param {string} taskType - The type of task to process
 * @returns {Object} Task definition or null
 */
function getTaskProcessor(taskType) {
  return taskTypes[taskType] || null;
}

/**
 * Get list of all available task types
 * @returns {Array} Array of task type names
 */
function getAvailableTaskTypes() {
  return Object.keys(taskTypes);
}

module.exports = {
  taskTypes,
  getTaskProcessor,
  getAvailableTaskTypes,
};
```

**Task Types Explained:**

Each task type simulates a real-world background job:
- **EMAIL**: Quick tasks (1-3s) like sending notifications
- **IMAGE_PROCESSING**: Medium tasks (3-8s) like resizing uploads
- **REPORT_GENERATION**: Longer tasks (2-6s) like PDF creation
- **DATA_BACKUP**: Heavy tasks (4-10s) like database backups

---

## 📝 Step 4: Create Task Producer API

**File: `task-producer.js`**

```javascript
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
    console.log('📡 Connecting to RabbitMQ...');
    
    // Establish connection to RabbitMQ server
    connection = await amqp.connect(config.rabbitmq.url);
    
    // Handle connection errors
    connection.on('error', (err) => {
      console.error('❌ Connection error:', err.message);
    });
    
    connection.on('close', () => {
      console.log('⚠️  Connection closed. Reconnecting...');
      setTimeout(initRabbitMQ, 5000);
    });

    // Create a channel for communication
    channel = await connection.createChannel();
    
    console.log('✅ Connected to RabbitMQ');

    // Declare the task queue with durable option
    // This ensures the queue persists across RabbitMQ restarts
    await channel.assertQueue(
      config.rabbitmq.queues.tasks,
      config.rabbitmq.queueOptions
    );
    
    console.log(`📋 Queue '${config.rabbitmq.queues.tasks}' is ready`);
  } catch (error) {
    console.error('❌ Failed to initialize RabbitMQ:', error.message);
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
      console.log(`✉️  Task published: ${task.id} (${taskType})`);
      return { success: true, taskId: task.id };
    } else {
      console.log('⚠️  Message buffer full, waiting...');
      return { success: false, error: 'Buffer full' };
    }
  } catch (error) {
    console.error('❌ Failed to publish task:', error.message);
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
      console.log(`🚀 Task Producer API running on port ${config.api.port}`);
      console.log(`📝 Available endpoints:`);
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
  console.log('\n🛑 Shutting down gracefully...');
  if (channel) await channel.close();
  if (connection) await connection.close();
  process.exit(0);
});

start();
```

**Key Points About Default Exchange:**

1. **Empty String Exchange**: We publish to the queue directly using `sendToQueue()`, which implicitly uses the default exchange ('')
2. **Queue Name as Routing Key**: The queue name acts as the routing key for the default exchange
3. **Persistent Messages**: `persistent: true` ensures messages survive RabbitMQ restarts
4. **Durable Queue**: Combined with persistent messages, provides reliability

---

## 📝 Step 5: Create Worker

**File: `worker.js`**

```javascript
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
```

**Worker Key Concepts:**

1. **Prefetch Count**: `channel.prefetch(1)` implements fair dispatch - workers get one message at a time
2. **Manual Acknowledgment**: `noAck: false` means workers must explicitly acknowledge messages
3. **ack()**: Removes message from queue after successful processing
4. **nack()**: Rejects message; `requeue: true` puts it back in the queue

---

## 📝 Step 6: Create Load Tester

**File: `load-tester.js`**

```javascript
const axios = require('axios');
const config = require('./config');
const { getAvailableTaskTypes } = require('./task-types');

const API_URL = `http://localhost:${config.api.port}`;

/**
 * Generate random task data based on task type
 */
function generateTaskData(taskType) {
  const taskData = {
    EMAIL: () => ({
      recipient: `user${Math.floor(Math.random() * 1000)}@example.com`,
      subject: `Test Email ${Date.now()}`,
      body: 'This is a test email from the load tester',
    }),
    IMAGE_PROCESSING: () => ({
      imageUrl: `https://example.com/images/image${Math.floor(Math.random() * 100)}.jpg`,
      dimensions: ['800x600', '1024x768', '1920x1080'][Math.floor(Math.random() * 3)],
      format: 'jpeg',
    }),
    REPORT_GENERATION: () => ({
      reportType: ['sales', 'inventory', 'analytics'][Math.floor(Math.random() * 3)],
      dateRange: '2024-01-01 to 2024-12-31',
      recordCount: Math.floor(Math.random() * 10000),
    }),
    DATA_BACKUP: () => ({
      database: ['users_db', 'products_db', 'orders_db'][Math.floor(Math.random() * 3)],
      size: `${Math.floor(Math.random() * 500)}MB`,
      compression: true,
    }),
  };

  return taskData[taskType] ? taskData[taskType]() : {};
}

/**
 * Submit a single task
 */
async function submitTask(taskType) {
  try {
    const response = await axios.post(`${API_URL}/api/tasks`, {
      type: taskType,
      data: generateTaskData(taskType),
    });
    
    return { success: true, data: response.data };
  } catch (error) {
    return { 
      success: false, 
      error: error.response?.data || error.message 
    };
  }
}

/**
 * Submit batch of tasks
 */
async function submitBatch(count) {
  const taskTypes = getAvailableTaskTypes();
  const tasks = [];

  for (let i = 0; i < count; i++) {
    const randomType = taskTypes[Math.floor(Math.random() * taskTypes.length)];
    tasks.push({
      type: randomType,
      data: generateTaskData(randomType),
    });
  }

  try {
    const response = await axios.post(`${API_URL}/api/tasks/batch`, { tasks });
    return { success: true, data: response.data };
  } catch (error) {
    return { 
      success: false, 
      error: error.response?.data || error.message 
    };
  }
}

/**
 * Run load test with specified parameters
 */
async function runLoadTest(options) {
  const {
    totalTasks = 100,
    batchSize = 10,
    delayBetweenBatches = 1000,
  } = options;

  console.log('🚀 Starting Load Test');
  console.log(`   Total Tasks: ${totalTasks}`);
  console.log(`   Batch Size: ${batchSize}`);
  console.log(`   Delay Between Batches: ${delayBetweenBatches}ms\n`);

  const batches = Math.ceil(totalTasks / batchSize);
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < batches; i++) {
    const currentBatchSize = Math.min(batchSize, totalTasks - (i * batchSize));
    
    console.log(`📦 Batch ${i + 1}/${batches} - Submitting ${currentBatchSize} tasks...`);
    
    const result = await submitBatch(currentBatchSize);
    
    if (result.success) {
      const batchSuccessCount = result.data.results.filter(r => r.success).length;
      successCount += batchSuccessCount;
      failCount += currentBatchSize - batchSuccessCount;
      console.log(`   ✅ Batch completed: ${batchSuccessCount}/${currentBatchSize} successful`);
    } else {
      failCount += currentBatchSize;
      console.log(`   ❌ Batch failed:`, result.error);
    }

    // Delay before next batch
    if (i < batches - 1) {
      await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
    }
  }

  console.log(`\n📊 Load Test Complete:`);
  console.log(`   Total Submitted: ${totalTasks}`);
  console.log(`   Successful: ${successCount}`);
  console.log(`   Failed: ${failCount}`);
  console.log(`   Success Rate: ${((successCount / totalTasks) * 100).toFixed(2)}%`);
}

/**
 * Interactive mode
 */
async function interactiveMode() {
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const taskTypes = getAvailableTaskTypes();

  console.log('\n🎮 Interactive Task Submission');
  console.log('Available task types:');
  taskTypes.forEach((type, index) => {
    console.log(`   ${index + 1}. ${type}`);
  });
  console.log('   0. Run Load Test');
  console.log('   q. Quit\n');

  rl.on('line', async (input) => {
    const choice = input.trim();

    if (choice === 'q') {
      console.log('👋 Goodbye!');
      rl.close();
      process.exit(0);
    }

    if (choice === '0') {
      rl.close();
      await runLoadTest({
        totalTasks: 50,
        batchSize: 10,
        delayBetweenBatches: 2000,
      });
      process.exit(0);
    }

    const index = parseInt(choice) - 1;
    if (index >= 0 && index < taskTypes.length) {
      const taskType = taskTypes[index];
      console.log(`\n📤 Submitting ${taskType} task...`);
      
      const result = await submitTask(taskType);
      
      if (result.success) {
        console.log(`✅ Task submitted: ${result.data.taskId}\n`);
      } else {
        console.log(`❌ Failed:`, result.error, '\n');
      }
    } else {
      console.log('❌ Invalid choice\n');
    }

    console.log('Choose an option (or "q" to quit):');
  });
}

// ============ MAIN ============

const args = process.argv.slice(2);

if (args.includes('--load-test')) {
  const totalIndex = args.indexOf('--total');
  const batchIndex = args.indexOf('--batch');
  const delayIndex = args.indexOf('--delay');

  runLoadTest({
    totalTasks: totalIndex >= 0 ? parseInt(args[totalIndex + 1]) : 100,
    batchSize: batchIndex >= 0 ? parseInt(args[batchIndex + 1]) : 10,
    delayBetweenBatches: delayIndex >= 0 ? parseInt(args[delayIndex + 1]) : 1000,
  });
} else {
  interactiveMode();
}
```

---

## 🧪 Step 7: Testing the System

### 1. **Start RabbitMQ**
```bash
docker run -d --name rabbitmq -p 5672:5672 -p 15672:15672 rabbitmq:3-management
```

Access Management UI: http://localhost:15672 (guest/guest)

### 2. **Start Task Producer**
```bash
node task-producer.js
```

You should see:
```
📡 Connecting to RabbitMQ...
✅ Connected to RabbitMQ
📋 Queue 'task_queue' is ready
🚀 Task Producer API running on port 3000
```

### 3. **Start Multiple Workers** (in separate terminals)

Terminal 1:
```bash
node worker.js
```

Terminal 2:
```bash
node worker.js
```

Terminal 3:
```bash
node worker.js
```

Each worker displays:
```
👷 worker_12345_abc - Starting...
✅ worker_12345_abc - Connected to RabbitMQ
📊 worker_12345_abc - Prefetch count set to 1
🎯 worker_12345_abc - Waiting for tasks...
```

### 4. **Submit Tasks Using Interactive Mode**
```bash
node load-tester.js
```

Choose options to submit individual tasks.

### 5. **Run Load Test**
```bash
node load-tester.js --load-test --total 100 --batch 20 --delay 1000
```

---

## 🔍 Observing Default Exchange Behavior

### **In RabbitMQ Management UI:**

1. Navigate to **Queues** tab
2. Click on `task_queue`
3. Observe:
   - **Ready**: Number of unprocessed messages
   - **Unacked**: Messages being processed by workers
   - **Total**: Total messages

4. Go to **Exchanges** tab
5. Notice the **(AMQP default)** exchange
6. Click on it - you'll see it has **no explicit bindings** shown
7. This is because bindings are implicit (every queue automatically bound)

### **Watching Round-Robin Distribution:**

With 3 workers running and continuous task submission:
- Worker 1 processes task 1, 4, 7, 10...
- Worker 2 processes task 2, 5, 8, 11...
- Worker 3 processes task 3, 6, 9, 12...

This is **round-robin distribution** in action!

---

## 🎓 Key Concepts Demonstrated

### **1. Default Exchange Characteristics**
- Pre-declared by RabbitMQ (always exists)
- Name is empty string `""`
- Cannot be deleted
- Type: Direct exchange
- Automatic binding: queue name = routing key

### **2. Fair Dispatch with Prefetch**
```javascript
channel.prefetch(1);
```
- Without prefetch: RabbitMQ dispatches messages evenly **at the time of dispatch**, not considering processing time
- With prefetch(1): Workers get one message at a time
- Result: Slow workers don't get overloaded; fast workers process more

### **3. Message Acknowledgments**

**Positive Ack** (Success):
```javascript
channel.ack(msg);
```
- Tells RabbitMQ: "I processed this successfully, remove it from queue"

**Negative Ack** (Failure):
```javascript
channel.nack(msg, false, true); // requeue = true
```
- Tells RabbitMQ: "I failed to process this, put it back in the queue"

**Auto-ack vs Manual-ack**:
- Auto-ack: Message removed immediately when delivered (not recommended for critical tasks)
- Manual-ack: Message removed only after explicit acknowledgment (safer)

### **4. Message Durability**

**Durable Queue**:
```javascript
{ durable: true }
```
- Queue survives RabbitMQ restarts

**Persistent Messages**:
```javascript
{ persistent: true }
```
- Messages are written to disk
- Combined with durable queue = reliability

**Important**: Both must be enabled for full durability!

---

## 💡 Practical Scenarios

### **Scenario 1: Worker Crash During Processing**

1. Worker receives message
2. Message is in "Unacked" state
3. Worker crashes before calling `ack()`
4. RabbitMQ detects channel closure
5. Message automatically re-queued
6. Another worker picks it up

**Test it**: Kill a worker (`Ctrl+C`) while it's processing a long task

### **Scenario 2: Processing Time Varies**

- EMAIL tasks: 1-3 seconds (fast)
- DATA_BACKUP tasks: 4-10 seconds (slow)

With `prefetch(1)`:
- Fast workers complete tasks quickly and get more work
- Slow workers process at their own pace
- Result: Optimal throughput

### **Scenario 3: RabbitMQ Restart**

1. Stop all workers
2. Submit 100 tasks
3. Restart RabbitMQ container
4. Start workers
5. All tasks are still in the queue (because durable queue + persistent messages)

---

## 📚 Additional Experiments

### **Experiment 1: Change Prefetch Count**

In `config.js`, change:
```javascript
prefetchCount: 5, // Instead of 1
```

Observe: Workers now buffer 5 messages each. If a worker is slow, those 5 messages wait.

### **Experiment 2: Auto-Ack**

In `config.js`, change:
```javascript
consumerOptions: {
  noAck: true, // Auto-acknowledge
}
```

Remove `channel.ack()` from worker.

Observe: Messages disappear immediately when delivered, even if processing fails!

### **Experiment 3: Non-Durable Queue**

Change:
```javascript
queueOptions: {
  durable: false,
}
```

Restart RabbitMQ with messages in queue. Observe: Queue and messages are gone!

---

## 🎯 Key Takeaways

1. **Default exchange** simplifies point-to-point messaging - just use the queue name
2. **Prefetch count** is essential for fair dispatch across multiple workers
3. **Manual acknowledgments** provide safety - messages aren't lost if workers crash
4. **Durability + Persistence** = reliability across restarts
5. **Round-robin distribution** happens naturally with multiple consumers on the same queue

---

## 🚀 Next Steps

You're now ready for **Lab 4: Direct Exchange** where you'll learn:
- Creating custom direct exchanges
- Using routing keys for targeted delivery
- Building a log routing system with multiple severity levels

The default exchange is a special case of direct exchange. Lab 4 will show you how to create your own!

---

## 📝 Complete package.json

```json
{
  "name": "lab3-task-queue",
  "version": "1.0.0",
  "description": "RabbitMQ Lab 3 - Default Exchange Task Queue",
  "main": "task-producer.js",
  "scripts": {
    "producer": "node task-producer.js",
    "worker": "node worker.js",
    "test": "node load-tester.js",
    "load-test": "node load-tester.js --load-test --total 100 --batch 20"
  },
  "keywords": ["rabbitmq", "task-queue", "default-exchange"],
  "author": "",
  "license": "ISC",
  "dependencies": {
    "amqplib": "^0.10.3",
    "axios": "^1.6.0",
    "express": "^4.18.2",
    "dotenv": "^16.3.1"
  }
}
```