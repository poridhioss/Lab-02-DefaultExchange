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
