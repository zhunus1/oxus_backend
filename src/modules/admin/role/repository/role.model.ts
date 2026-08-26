export interface RoleModel {
  id: number;
  name: string;
  code: string;
  description?: string | null;
  permissions?: Array<{ id: number; name: string; code: string; decription?: string | null }>;
}
