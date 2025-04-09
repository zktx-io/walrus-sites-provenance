// 0 means each blob contains only one file
export const MAX_BLOB_SIZE = 0;

// One registration requires 2 commands: reserve_space + register_blob
export const MAX_CMD_REGISTRATIONS = 200;

// One certification requires 1 command
export const MAX_CMD_CERTIFICATIONS = 500;

// Creating one site resource requires 5 commands:
// 1 for new_range_option, 1 for new_resource, 2 for add_header, and 1 for add_resource
export const MAX_CMD_SITE_CREATE = 100;

// Updating one site resource also requires 5 commands:
// 1 for new_range_option, 1 for new_resource, 2 for add_header, and 1 for add_resource
// Additionally, 1 command is needed for each old resource to be removed
export const MAX_CMD_SITE_UPDATE = 100;
