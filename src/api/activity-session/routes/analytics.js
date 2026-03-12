module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/activity-sessions/analytics/global',
      handler: 'analytics.getGlobalData',
      config: {  auth: false }, 
    },
    {
      method: 'GET',
      path: '/activity-sessions/analytics/student/:documentId',
      handler: 'analytics.getStudentData',
      config: { auth: false },
    },
    {
      method: 'GET',
      path: '/activity-sessions/analytics/compare',
      handler: 'analytics.getComparisonData',
      config: { auth: false },
    }
  ]
};