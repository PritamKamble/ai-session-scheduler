// SSPL License Header
// Copyright (C) 2025 Your Company. All Rights Reserved.
//
// This file is part of the LinkCode Scheduler project, licensed under the Server Side Public License, version 1.
//
// See the SSPL for details: https://www.mongodb.com/licensing/server-side-public-license

import { useEffect, useState } from 'react';

export interface Permission {
  tenant_id: string;
  role: string;
  resource: string;
  action: string;
  conditions?: Record<string, unknown>;
}

export function usePermission(
  userRoles: string[],
  tenantId: string,
  resource: string,
  action: string,
  permissions: Permission[]
): boolean {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    setAllowed(
      permissions.some(
        (perm) =>
          perm.tenant_id === tenantId &&
          userRoles.includes(perm.role) &&
          perm.resource === resource &&
          perm.action === action
      )
    );
  }, [userRoles, tenantId, resource, action, permissions]);
  return allowed;
}
