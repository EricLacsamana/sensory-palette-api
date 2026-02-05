'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/activity-sessions/unavailable-slots',
      handler: 'activity-session.getUnavailableSlots',
      config: {
        auth: false,
      },
    },
  ],
};