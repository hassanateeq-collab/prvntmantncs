-- Create the four branch manager logins.
--
-- Idempotent: running it again refreshes the password/profile without creating
-- duplicate auth users.

do $$
declare
  rec record;
  v_id uuid;
begin
  for rec in
    select *
    from (
      values
        ('hammad@hamsun.com', 'hammad9957', 'Hammad Salafi', 'FSL'),
        ('zafar@hamsun.com', 'zafar9957', 'Zafar Abid', 'CLF'),
        ('kumail@hamsun.com', 'kumail9957', 'Kumail Hussain', 'EXT'),
        ('areeba@hamsun.com', 'areeba9957', 'Areeba Mansoor', 'DHA')
    ) as t(email, password, full_name, branch_code)
  loop
    select id into v_id from auth.users where lower(email) = rec.email;

    if v_id is null then
      v_id := gen_random_uuid();

      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at,
        raw_app_meta_data, raw_user_meta_data,
        confirmation_token, recovery_token,
        email_change_token_new, email_change, email_change_token_current,
        phone_change, phone_change_token, reauthentication_token,
        is_sso_user, is_anonymous
      ) values (
        '00000000-0000-0000-0000-000000000000',
        v_id,
        'authenticated',
        'authenticated',
        rec.email,
        extensions.crypt(rec.password, extensions.gen_salt('bf')),
        now(),
        now(),
        now(),
        jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', 'branch_manager'),
        jsonb_build_object('full_name', rec.full_name),
        '', '',
        '', '', '',
        '', '', '',
        false,
        false
      );

      insert into auth.identities (
        id, provider_id, user_id, identity_data, provider,
        last_sign_in_at, created_at, updated_at
      ) values (
        gen_random_uuid(),
        v_id::text,
        v_id,
        jsonb_build_object('sub', v_id::text, 'email', rec.email, 'email_verified', true),
        'email',
        now(), now(), now()
      );
    else
      update auth.users
      set encrypted_password = extensions.crypt(rec.password, extensions.gen_salt('bf')),
          email_confirmed_at = coalesce(email_confirmed_at, now()),
          updated_at = now()
      where id = v_id;
    end if;

    insert into public.profiles (
      id, email, full_name, role, branch_code, department, is_active
    ) values (
      v_id, rec.email, rec.full_name, 'branch_manager', rec.branch_code, 'housekeeping', true
    )
    on conflict (id) do update
    set email = excluded.email,
        full_name = excluded.full_name,
        role = 'branch_manager',
        branch_code = excluded.branch_code,
        department = 'housekeeping',
        is_active = true,
        updated_at = now();
  end loop;
end;
$$;
