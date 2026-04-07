'use strict';

/**
 * appointment router
 */

const { createCoreRouter } = require('@strapi/strapi').factories;

module.exports = createCoreRouter('api::appointment.appointment', {
  config: {
    find: {
      policies: ['global::filter-by-owner'],
    },
    findOne: {
      policies: ['global::filter-by-owner'],
    },
  },
});