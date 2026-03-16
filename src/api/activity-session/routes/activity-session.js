const { createCoreRouter } = require('@strapi/strapi').factories;

module.exports = createCoreRouter('api::activity-session.activity-session', {
  config: {
    find: {
      policies: ['global::filter-by-owner'],
    },
    findOne: {
      policies: ['global::filter-by-owner'],
    },
    create: {
      policies: ['global::bind-user-therapist'],
    },
    update: {
      policies: ['global::bind-user-therapist'],
    },
  },
});