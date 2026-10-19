export function mapDatabaseGroup(group) {
  return {
    id: group.id,
    name: group.name,
    type: group.group_type,
    description: group.description || "",
    createdBy: group.created_by,
    createdAt: group.created_at,
  };
}
