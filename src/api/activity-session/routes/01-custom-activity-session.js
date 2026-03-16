'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/activity-sessions/:id/recommend', 
      handler: 'api::activity-session.activity-session.triggerAiRecommendation',
      config: {
        policies: [],
        middlewares: [],
      },
    },
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
  ],
};