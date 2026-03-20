const os = require('os');
const cronTasks = require('./cron-tasks');

// Function to auto-detect your active local IP on the network
function getNetworkIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const networkInterface = interfaces[name];
    
    // THE FIX: We check if it is defined before trying to loop through it
    if (networkInterface) {
      for (const iface of networkInterface) {
        // Look for an IPv4 address that is NOT localhost (127.0.0.1)
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
  }
  return '127.0.0.1'; // Fallback just in case you are disconnected
}

const currentIp = getNetworkIp();

module.exports = ({ env }) => ({
  host: env('HOST', '127.0.0.1'), // 0.0.0.0 ensures it listens to the network
  port: env.int('PORT', 1337),
  url: `http://${currentIp}:${env.int('PORT', 1337)}`, // Dynamically sets your current network IP
  app: {
    keys: env.array('APP_KEYS'),
  },
  webhooks: {
    populateRelations: env.bool('WEBHOOKS_POPULATE_RELATIONS', false),
  },
  cron: { 
    enabled: true, 
    tasks: cronTasks, 
  }
});