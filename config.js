require('dotenv').config();

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