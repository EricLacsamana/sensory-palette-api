module.exports = (plugin) => {
  const routes = plugin.routes['content-api'].routes;

  routes.forEach((route) => {

    if (
      (route.handler === 'user.find' || route.handler === 'user.findOne') &&
      route.method === 'GET'
    ) {
      route.config.policies = route.config.policies || [];
      route.config.policies.push('global::role-based-user-filter');
    }
  });

  return plugin;
};