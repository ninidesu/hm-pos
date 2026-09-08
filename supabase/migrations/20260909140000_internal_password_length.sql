-- HM POS internal passwords are intentionally simple: 8 to 12 characters.
-- Keep the deployed direct-user RPCs aligned with the portal forms.

do $$
declare
  v_definition text;
begin
  v_definition := pg_get_functiondef('public.admin_create_portal_user(text,text,text,text)'::regprocedure);
  if v_definition is not null then
    execute replace(replace(v_definition, 'between 8 and 32', 'between 8 and 12'), '8 to 32', '8 to 12');
  end if;

  v_definition := pg_get_functiondef('public.admin_update_portal_user_credentials(uuid,text,text)'::regprocedure);
  if v_definition is not null then
    execute replace(replace(v_definition, 'between 8 and 32', 'between 8 and 12'), '8 to 32', '8 to 12');
  end if;
end;
$$;

notify pgrst, 'reload schema';
