// Synthetic records for visual checks; never loaded by the application or a real database.
export const id = n => `123e4567-e89b-42d3-a456-${String(n).padStart(12, '0')}`;
const permissions = ['catalog:write', 'stock:move', 'inventory:count', 'inventory:adjust', 'reports:read', 'costs:read', 'users:manage', 'settings:manage', 'records:delete', 'orders:read', 'orders:write', 'orders:apply', 'orders:invoice', 'purchases:read', 'purchases:write', 'purchases:receive'];
export const user = {
  id: id(1), authUserId: id(2), name: 'Equipe de demonstração', email: 'equipe@example.invalid',
  active: true, unitId: id(3), organizationId: id(4), roleId: id(5),
  role: { id: id(5), name: 'ADMINISTRADOR' }, permissions,
  memberships: [{ unitId: id(3), unitName: 'U.C.A. — demonstração', organizationId: id(4), organizationName: 'U.C.A.', roleId: id(5), roleName: 'ADMINISTRADOR' }],
};
const category = { id: id(6), name: 'Peças de manutenção' };
export const data = {
  user, unitId: user.unitId, organizationId: user.organizationId, permissions, roles: [user.role],
  products: ['Rolamento rígido 6204', 'Correia de transmissão B-72', 'Disco de corte 18 polegadas', 'Parafuso sextavado M12'].map((name, i) => ({
    id: id(10 + i), name, internalCode: ['ROL-6204', 'COR-B72', 'DIS-018', 'PAR-M12'][i],
    unit: 'UN', active: true, minStock: '10', category, categoryId: category.id,
    unitCost: '24.50', createdAt: '2026-11-12T12:00:00Z',
  })),
  categories: [category], suppliers: [],
  warehouses: [{ id: id(7), name: 'Almoxarifado de demonstração', code: 'ALM-01', active: true }],
  locations: [{ id: id(8), name: 'Estante A — Prateleira 02', code: 'A-P02', warehouseId: id(7), active: true }],
  balances: [24, 7, 0, 120].map((quantity, i) => ({ id: id(20 + i), productId: id(10 + i), locationId: id(8), quantity: String(quantity), physicalQuantity: String(quantity), availableQuantity: String(quantity), reservedQuantity: '0', appliedQuantity: '0' })),
  movements: [], counts: [], audit: [], users: [], settings: { companyName: 'U.C.A. — demonstração', allowNegativeStock: false },
};
