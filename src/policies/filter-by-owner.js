export default async (policyContext, config, { strapi }) => {
  const ctx = policyContext.http?.ctx || policyContext;

  if (!ctx.query && ctx.request?.query) {
    ctx.query = ctx.request.query;
  }

  const user = ctx.state?.user;
  if (!user) return false;

  const userWithRole = await strapi.entityService.findOne('plugin::users-permissions.user', user.id, {
    populate: ['role'],
  });

  const roleType = userWithRole?.role?.type;
  
  // 1. Capture what is already there or start with an empty object
  const existingFilters = ctx.query.filters || {};

  if (roleType === 'therapist') {
    // 2. Merge existing filters with our mandatory therapist filter
    ctx.query.filters = {
      ...existingFilters,
      therapist: { id: { $eq: user.id } }
    };
    console.log(`Policy Log: Merged therapist filter for ID ${user.id}`);
    
  } else if (roleType === 'student') {
    // 2. Merge existing filters with our mandatory student filter
    ctx.query.filters = {
      ...existingFilters,
      student: { id: { $eq: user.id } }
    };
    console.log(`Policy Log: Merged student filter for ID ${user.id}`);
  }

  ctx.request.query = ctx.query;

  return true;
};