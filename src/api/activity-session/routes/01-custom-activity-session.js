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
  ],
};