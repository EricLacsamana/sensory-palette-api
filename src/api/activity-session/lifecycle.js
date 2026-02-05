module.exports = {
  async beforeUpdate(event) {
    const { data } = event.params;

    // Triggered when frontend updates status to 'completed'
    if (data.status === 'completed' && data.rawTelemetry) {
      const telemetry = data.rawTelemetry;
      
      // 1. Calculate Duration
      if (data.startTime && data.endTime) {
        const start = new Date(data.startTime);
        const end = new Date(data.endTime);
        data.durationSeconds = Math.floor((end.getTime() - start.getTime()) / 1000);
      }

      // 2. Performance Aggregation
      const totalEvents = telemetry.length;
      const successfulEvents = telemetry.filter(t => t.success === true).length;
      
      data.successRate = totalEvents > 0 ? parseFloat((successfulEvents / totalEvents).toFixed(2)) : 0;
      data.actualScore = Math.round(data.successRate * 100);

      // 3. Clinical Latency (Processing Speed)
      const latencies = telemetry.map(t => t.latencyMs).filter(l => l != null);
      data.avgLatency = latencies.length > 0 
        ? parseFloat((latencies.reduce((a, b) => a + b) / latencies.length).toFixed(3))
        : 0;
    }
  },
};