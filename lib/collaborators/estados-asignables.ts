// Estados de un perfil de colaborador a los que un admin/director puede asignar un contacto
// desde la ficha. Un colaborador recién dado de alta nace 'invited' (aún sin contrato firmado)
// y ya debe poder recibir contactos; solo 'suspended' e 'inactive' quedan fuera.
// Fuente única: la usan el desplegable de la ficha y la validación de la API de atribución.
export const ESTADOS_COLABORADOR_ASIGNABLES = ['invited', 'pending_contract', 'active'] as const
