'use strict';

module.exports = {
  async passcodeLogin(ctx) {
    const { passcode } = ctx.request.body;

    if (!passcode) {
      return ctx.badRequest('Passcode is required');
    }

    // 1. Find the user with this exact passcode where it HAS NOT expired
    const users = await strapi.entityService.findMany('plugin::users-permissions.user', {
      filters: {
        activePasscode: passcode,
        passcodeExpiresAt: { $gt: new Date().toISOString() } 
      },
      limit: 1
    });

    if (!users || users.length === 0) {
      return ctx.badRequest('Invalid or expired passcode.');
    }

    const user = users[0];

    // 2. Issue a real Strapi JWT for this student
    const issueToken = strapi.plugin('users-permissions').service('jwt').issue;
    const token = issueToken({ id: user.id });

    // ✨ Notice we no longer burn the passcode here! It stays alive for the whole cycle.

    // 3. Return standard Strapi Auth response
    return ctx.send({
      jwt: token,
      user: user
    });
  }
};