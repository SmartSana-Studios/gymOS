// Story 24.10: the contract between the proxy and the page route handler, in ONE module so neither side can drift: the rewrite target and
// the two request headers the proxy sets (and deletes inbound).
export const GYM_SITE_PATH = "/gym-site";
export const TENANT_NAME_HEADER = "x-tenant-name";
export const TENANT_PATH_HEADER = "x-tenant-path";
/** Every inbound header with this prefix is deleted by the proxy before it sets its own. */
export const TENANT_HEADER_PREFIX = "x-tenant-";
