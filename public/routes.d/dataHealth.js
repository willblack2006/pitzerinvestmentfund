// Data health page (public-data rebuild, step 1.1): admins only.
export default { pattern: "data-health", load: () => import("../views/dataHealth.js"), section: "settings" };
