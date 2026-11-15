define([], () => {
  'use strict';

  // The shop's menu: each item opens a page of a flow.
  const NAV_GROUPS = [
    { label: 'Customers', items: [
      { id: 'customer-dashboard', label: 'Customer Dashboard', flow: 'customers', page: 'customer-dashboard' },
      { id: 'customer-billing', label: 'My Billing', flow: 'customers', page: 'customer-billing' }
    ] },
    { label: 'Orders', items: [
      { id: 'order-list', label: 'Order Workbench', flow: 'orders', page: 'order-list' },
      { id: 'order-create', label: 'New Order', flow: 'orders', page: 'order-create' }
    ] }
  ];
  // Who sees what: the role codes the app checks against the user's roles
  const ROLE_ADMIN = 'SHOP_ADMIN';
  const ROLE_CLERK = 'SHOP_CLERK';
  const ROLE_VIEWER = 'SHOP_VIEWER';

  class AppModule {
    navGroups() { return NAV_GROUPS; }
    /** Whether the user's roles hold one of these (userRoles from the USER_ROLES report). */
    hasRole(roles, wanted) { return (roles || []).some((r) => (wanted || []).indexOf(r) !== -1); }
    canEditOrders(roles) { return this.hasRole(roles, [ROLE_ADMIN, ROLE_CLERK]); }
    canSeeBilling(roles) { return this.hasRole(roles, [ROLE_ADMIN, ROLE_VIEWER]); }
  }

  return AppModule;
});
