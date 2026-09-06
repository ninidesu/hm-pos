import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
const validEmail = (value: string) => value.length <= 160 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
const validName = (value: string) => /^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ .'-]{1,59}$/.test(value);
const validUsername = (value: string) => /^[A-Za-z0-9._-]{3,24}$/.test(value);

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ success: false, error: "Use POST." }, 405);
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ success: false, error: "User management is unavailable." }, 500);

  try {
    const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || "";
    const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData.user) return json({ success: false, error: "Authentication required." }, 401);

    const { data: caller } = await admin.from("users").select("id,role,full_name,username,email").eq("id", authData.user.id).maybeSingle();
    if (String(caller?.role || "").trim().toLowerCase() !== "admin") {
      return json({ success: false, error: "Administrator access required." }, 403);
    }

    const body = await request.json();
    const action = String(body?.action || "");

    if (action === "invite") {
      const email = String(body?.email || "").trim().toLowerCase();
      const fullName = String(body?.fullName || "").trim();
      const username = String(body?.username || "").trim() || null;
      const role = String(body?.role || "").trim().toLowerCase();
      if (!validEmail(email) || !validName(fullName) || (username && !validUsername(username)) || !["admin", "cashier"].includes(role)) {
        return json({ success: false, error: "Name, email, and a valid portal role are required." }, 400);
      }

      const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
        data: { full_name: fullName, username, role },
      });
      if (inviteError) throw inviteError;
      const userId = invited.user?.id;
      if (!userId) throw new Error("The invitation did not return a user account.");

      const { error: profileError } = await admin.from("users").upsert({
        id: userId, email, full_name: fullName, username, role,
      }, { onConflict: "id" });
      if (profileError) throw profileError;

      await admin.from("portal_audit_events").insert({
        actor_id: caller.id,
        actor_name_snapshot: caller.full_name || caller.username || caller.email,
        actor_role_snapshot: "admin",
        surface: "admin",
        module: "users_access",
        action: "user.added",
        entity_type: "profile",
        entity_id: userId,
        entity_label: fullName,
        summary: `${caller.full_name || caller.email} added ${fullName} as ${role.replaceAll("_", " ")}`,
        after_data: { email, full_name: fullName, username, role },
      });
      return json({ success: true, user: { id: userId, email, full_name: fullName, username, role } });
    }

    if (action === "reset_password") {
      const userId = String(body?.userId || "");
      const { data: target, error: targetError } = await admin.from("users").select("id,email,full_name,username").eq("id", userId).maybeSingle();
      if (targetError || !target?.email) return json({ success: false, error: "User account not found." }, 404);
      const { error: resetError } = await authClient.auth.resetPasswordForEmail(target.email);
      if (resetError) throw resetError;
      await admin.from("portal_audit_events").insert({
        actor_id: caller.id,
        actor_name_snapshot: caller.full_name || caller.username || caller.email,
        actor_role_snapshot: "admin",
        surface: "admin",
        module: "users_access",
        action: "user.password_reset_requested",
        entity_type: "profile",
        entity_id: target.id,
        entity_label: target.full_name || target.username || target.email,
        summary: `${caller.full_name || caller.email} sent a password reset to ${target.full_name || target.email}`,
      });
      return json({ success: true });
    }

    if (action === "update") {
      const userId = String(body?.userId || "");
      const username = String(body?.username || "").trim();
      const { data: target, error: targetError } = await admin.from("users")
        .select("id,email,full_name,username,role").eq("id", userId).maybeSingle();
      if (targetError || !target) return json({ success: false, error: "User account not found." }, 404);
      const isCurrentAdmin = userId === caller.id;
      const requestedEmail = body?.email == null ? "" : String(body.email).trim().toLowerCase();
      const requestedPassword = body?.password == null ? "" : String(body.password);
      const email = isCurrentAdmin ? target.email : requestedEmail;
      const password = isCurrentAdmin ? "" : requestedPassword;
      if (!userId || !validUsername(username) || (!isCurrentAdmin && !validEmail(email)) || (password && (password.length < 8 || password.length > 72))) {
        return json({ success: false, error: "A valid username, email, and optional password are required." }, 400);
      }

      const { data: authTarget, error: authLookupError } = await admin.auth.admin.getUserById(userId);
      if (authLookupError || !authTarget.user) throw authLookupError || new Error("Authentication account not found.");
      const authChanges: { email?: string; user_metadata: Record<string, unknown>; password?: string } = {
        user_metadata: { ...(authTarget.user.user_metadata || {}), username },
      };
      if (!isCurrentAdmin) authChanges.email = email;
      if (password) authChanges.password = password;
      const { error: authUpdateError } = await admin.auth.admin.updateUserById(userId, authChanges);
      if (authUpdateError) throw authUpdateError;

      const updatedAt = new Date().toISOString();
      const profileChanges: { username: string; updated_at: string; email?: string } = { username, updated_at: updatedAt };
      if (!isCurrentAdmin) profileChanges.email = email;
      const { data: updated, error: profileError } = await admin.from("users")
        .update(profileChanges).eq("id", userId)
        .select("id,email,full_name,username,role").single();
      if (profileError) throw profileError;

      await admin.from("portal_audit_events").insert({
        actor_id: caller.id,
        actor_name_snapshot: caller.full_name || caller.username || caller.email,
        actor_role_snapshot: "admin",
        surface: "admin",
        module: "users_access",
        action: "user.credentials_updated",
        entity_type: "profile",
        entity_id: target.id,
        entity_label: updated.full_name || updated.username || updated.email,
        summary: `${caller.full_name || caller.email} updated ${updated.full_name || updated.email}`,
        before_data: { email: target.email, username: target.username },
        after_data: { email: updated.email, username: updated.username, password_changed: Boolean(password) },
      });
      return json({ success: true, user: updated });
    }

    if (action === "remove") {
      const userId = String(body?.userId || "");
      if (!userId) return json({ success: false, error: "User account is required." }, 400);
      if (userId === caller.id) return json({ success: false, error: "You cannot remove your own administrator account." }, 400);

      const { data: target, error: targetError } = await admin.from("users")
        .select("id,email,full_name,username,role,removed_at").eq("id", userId).maybeSingle();
      if (targetError?.code === "42703" || targetError?.message?.includes("removed_at")) {
        return json({ success: false, error: "User removal needs the portal user removal migration." }, 503);
      }
      if (targetError || !target || target.removed_at) return json({ success: false, error: "User account not found." }, 404);

      if (String(target.role || "").trim().toLowerCase() === "admin") {
        const { count, error: countError } = await admin.from("users")
          .select("id", { count: "exact", head: true }).eq("role", "admin").is("removed_at", null).neq("id", userId);
        if (countError) throw countError;
        if (!count) return json({ success: false, error: "At least one administrator is required." }, 409);
      }

      const { error: deleteError } = await admin.auth.admin.deleteUser(userId, true);
      if (deleteError) throw deleteError;
      const removedAt = new Date().toISOString();
      const { error: profileError } = await admin.from("users")
        .update({ removed_at: removedAt, updated_at: removedAt }).eq("id", userId);
      if (profileError) throw profileError;

      await admin.from("portal_audit_events").insert({
        actor_id: caller.id,
        actor_name_snapshot: caller.full_name || caller.username || caller.email,
        actor_role_snapshot: "admin",
        surface: "admin",
        module: "users_access",
        action: "user.removed",
        entity_type: "profile",
        entity_id: target.id,
        entity_label: target.full_name || target.username || target.email,
        summary: `${caller.full_name || caller.email} removed ${target.full_name || target.email} from portal access`,
        severity: "critical",
        before_data: { email: target.email, full_name: target.full_name, username: target.username, role: target.role },
        after_data: { removed_at: removedAt },
      });
      return json({ success: true });
    }

    return json({ success: false, error: "Unsupported user-management action." }, 400);
  } catch (error) {
    console.error("admin-manage-user failed", error);
    return json({ success: false, error: error instanceof Error ? error.message : "User management failed." }, 500);
  }
});
