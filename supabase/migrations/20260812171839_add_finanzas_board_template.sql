-- Nueva plantilla de sistema "Finanzas", siguiendo el mismo patrón que
-- Desarrollo/Marketing/Ventas (tenant_id null = built-in disponible para
-- cualquier organización vía fetchBoardTemplates).
insert into public.board_templates (name, default_columns, default_automations, custom_field_schema, default_views)
values (
  'Finanzas',
  '[
    {"key": "por_procesar", "color": "--low", "label": "Por procesar", "order_index": 0, "is_done_state": false},
    {"key": "en_revision", "color": "--medium", "label": "En revisión", "order_index": 1, "is_done_state": false},
    {"key": "aprobado", "color": "--accent", "label": "Aprobado", "order_index": 2, "is_done_state": false},
    {"key": "pagado", "color": "--muted", "label": "Pagado", "order_index": 3, "is_done_state": true}
  ]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  array['kanban', 'tabla', 'dashboard']
);
