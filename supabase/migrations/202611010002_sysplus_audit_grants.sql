-- Her? V3: restrict the SYS+ audit log to append-only server-side inserts.
revoke all on public.sysplus_audit_log from anon, authenticated, service_role;
grant insert on public.sysplus_audit_log to service_role;
grant usage, select on sequence public.sysplus_audit_log_id_seq to service_role;
