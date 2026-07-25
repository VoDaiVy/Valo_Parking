import { useState, useEffect, useRef } from "react";
import { apiFetch, API_BASE } from "../../services/api";
import {
  forgotPassword as apiForgotPassword,
  verifyResetPasswordOTP as apiVerifyResetOTP,
  resetPassword as apiResetPassword,
} from "../../services/authService";
import {
  Camera,
  Check,
  X,
  Key,
  User,
  Phone,
  Mail,
  CalendarDays,
  Eye,
  EyeOff,
  Shield,
  Lock,
  LockOpen,
  ArrowLeft,
  RotateCw,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const getPwdChecks = (pwd) => ({
  length: pwd.length >= 8,
  cases: /[A-Z]/.test(pwd) && /[a-z]/.test(pwd),
  number: /[0-9]/.test(pwd),
  special: /[^a-zA-Z0-9]/.test(pwd),
});

const getPwdStrength = (pwd) => {
  const c = getPwdChecks(pwd);
  return [c.length, c.cases, c.number, c.special].filter(Boolean).length;
};

const getInitials = (name = "") =>
  name
    .split(" ")
    .map((w) => w[0])
    .slice(-2)
    .join("")
    .toUpperCase();

const buildProfile = (raw) => {
  const p = raw.profile || {};
  const firstName = p.firstName || raw.firstName || "";
  const lastName = p.lastName || raw.lastName || "";
  const name =
    [firstName, lastName].filter(Boolean).join(" ") || raw.username || "User";
  return {
    name,
    firstName,
    lastName,
    phone: p.phone || raw.phone || "",
    email: raw.email || "",
    avatar: p.avatar || raw.avatar || "",
    role: raw.role || "Staff",
    createdAt: raw.createdAt || null,
    isGoogleUser: !!raw.isGoogleUser,
  };
};

// ─── Emerald underline editable field ────────────────────────────────────────
function EmeraldUnderlineField({ field, label, value, readOnly = false, onSave, icon: Icon }) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const save = () => { onSave(field, draft); setIsEditing(false); };
  const cancel = () => { setDraft(value); setIsEditing(false); };

  return (
    <div className="group">
      <label
        className="flex items-center gap-1 mb-1 tracking-[0.2em] text-[10px] font-semibold"
        style={{ color: "rgba(234,179,8,0.7)" }}
      >
        {Icon && <Icon size={10} />}
        {label}
      </label>

      {readOnly ? (
        <p className="w-full pb-1.5 text-sm" style={{ borderBottom: "1px solid rgba(255,255,255,0.15)", color: "#e2e1eb" }}>
          {value || "—"}
        </p>
      ) : isEditing ? (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") cancel(); }}
            className="flex-1 bg-transparent pb-1.5 text-sm outline-none"
            style={{ borderBottom: "1px solid #EAB308", color: "#e2e1eb" }}
          />
          <button onClick={save} className="shrink-0 transition-colors text-emerald-400 hover:text-emerald-300"><Check size={15} /></button>
          <button onClick={cancel} className="shrink-0 transition-colors text-red-400 hover:text-red-300"><X size={15} /></button>
        </div>
      ) : (
        <div
          className="flex items-center gap-2 pb-1.5 transition-all duration-300"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.15)" }}
          onMouseEnter={(e) => (e.currentTarget.style.borderBottomColor = "rgba(234,179,8,0.5)")}
          onMouseLeave={(e) => (e.currentTarget.style.borderBottomColor = "rgba(255,255,255,0.15)")}
        >
          <span className="flex-1 text-sm" style={{ color: "#e2e1eb" }}>
            {value || <span className="italic text-sm text-gray-600">—</span>}
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function StaffProfile() {
  const avatarInputRef = useRef(null);
  const spotlightRef = useRef(null);
  const orbRef = useRef(null);
  const magneticRef = useRef(null);
  const fpOtpRefs = useRef([]);

  // ── Profile state ──────────────────────────────────────────────────────────
  const [profile, setProfile] = useState({
    name: "",
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    avatar: "",
    role: "Staff",
    createdAt: null,
    isGoogleUser: false,
  });
  const [toast, setToast] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [formDraft, setFormDraft] = useState({ name: "", phone: "" });
  const [formErrors, setFormErrors] = useState({ name: "", phone: "" });

  // ── Change Password modal state ────────────────────────────────────────────
  const [cpOpen, setCpOpen] = useState(false);
  const [cpForm, setCpForm] = useState({ current: "", newPwd: "", confirm: "" });
  const [cpShow, setCpShow] = useState({ current: false, newPwd: false, confirm: false });
  const [cpErrors, setCpErrors] = useState({ current: "", newPwd: "", confirm: "" });
  const [cpLoading, setCpLoading] = useState(false);
  const [cpRipple, setCpRipple] = useState(false);
  const [cpLockOpen, setCpLockOpen] = useState(false);
  const [avatarLoading, setAvatarLoading] = useState(false);

  // ── Forgot current password sub-flow ──────────────────────────────────────
  const [fpStep, setFpStep] = useState(null);
  const [fpOtpDigits, setFpOtpDigits] = useState(Array(6).fill(""));
  const [fpVerifiedOTP, setFpVerifiedOTP] = useState("");
  const [fpNewPwd, setFpNewPwd] = useState("");
  const [fpConfirmPwd, setFpConfirmPwd] = useState("");
  const [fpLoading, setFpLoading] = useState(false);
  const [fpShow, setFpShow] = useState({ newPwd: false, confirm: false });
  const [fpError, setFpError] = useState("");

  // ── Spotlight + orb parallax ───────────────────────────────────────────────
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (spotlightRef.current) {
        spotlightRef.current.style.setProperty("--x", `${e.clientX}px`);
        spotlightRef.current.style.setProperty("--y", `${e.clientY}px`);
      }
      if (orbRef.current) {
        const xAxis = (window.innerWidth / 2 - e.pageX) / 40;
        const yAxis = (window.innerHeight / 2 - e.pageY) / 40;
        orbRef.current.style.transform = `rotateY(${xAxis}deg) rotateX(${yAxis}deg)`;
      }
    };
    document.addEventListener("mousemove", handleMouseMove);
    return () => document.removeEventListener("mousemove", handleMouseMove);
  }, []);

  // ── Fetch user data ────────────────────────────────────────────────────────
  useEffect(() => {
    const fetchUserData = async () => {
      const cached = JSON.parse(sessionStorage.getItem("valo_user") || "null");
      if (cached) setProfile(buildProfile(cached));

      const token = localStorage.getItem("accessToken");
      if (!token) return;

      const { ok, data } = await apiFetch("/profile", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (ok && data?.success) {
        setProfile(buildProfile(data.data));
        sessionStorage.setItem(
          "valo_user",
          JSON.stringify({ ...data.data, avatar: data.data.profile?.avatar || "" }),
        );
        window.dispatchEvent(new Event("valo_auth_change"));
      }
    };
    fetchUserData();
  }, []);

  // ── Toast helper ───────────────────────────────────────────────────────────
  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  };

  // ── Save profile field ─────────────────────────────────────────────────────
  const handleSaveProfile = async (field, value) => {
    const updated = { ...profile, [field]: value };
    if (field === "name") {
      const spaceIdx = value.lastIndexOf(" ");
      updated.firstName = spaceIdx > 0 ? value.slice(0, spaceIdx) : value;
      updated.lastName = spaceIdx > 0 ? value.slice(spaceIdx + 1) : "";
    }
    setProfile(updated);
    setToast({ msg: "Saving...", type: "saving" });

    const token = localStorage.getItem("accessToken");
    if (!token) { showToast("Not authenticated", "error"); return; }

    const { ok, data } = await apiFetch("/profile", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ firstName: updated.firstName, lastName: updated.lastName, phone: updated.phone }),
    });

    if (ok && data?.success) {
      const merged = { ...data.data, createdAt: profile.createdAt };
      setProfile(buildProfile(merged));
      sessionStorage.setItem("valo_user", JSON.stringify(merged));
      window.dispatchEvent(new Event("valo_auth_change"));
      setToast({ msg: "Profile updated ✓", type: "success" });
      setTimeout(() => setToast(null), 2000);
    } else {
      setProfile(profile);
      showToast(data?.message || "Update failed", "error");
    }
  };

  // ── Avatar upload ──────────────────────────────────────────────────────────
  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) { showToast("Image must be under 5 MB.", "error"); return; }

    const previewUrl = URL.createObjectURL(file);
    const prevAvatar = profile.avatar;
    setProfile((prev) => ({ ...prev, avatar: previewUrl }));
    setAvatarLoading(true);

    const token = localStorage.getItem("accessToken");
    const formData = new FormData();
    formData.append("avatar", file);

    try {
      const res = await fetch(`${API_BASE}/profile/avatar`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();

      if (res.ok && data?.success) {
        const cloudinaryUrl = data.data.avatarUrl;
        setProfile((prev) => ({ ...prev, avatar: cloudinaryUrl }));
        const cached = JSON.parse(sessionStorage.getItem("valo_user") || "null");
        if (cached) sessionStorage.setItem("valo_user", JSON.stringify({ ...cached, avatar: cloudinaryUrl }));
        window.dispatchEvent(new Event("valo_auth_change"));
        showToast("Avatar updated ✓", "success");
      } else {
        setProfile((prev) => ({ ...prev, avatar: prevAvatar }));
        showToast(data?.message || "Upload failed.", "error");
      }
    } catch {
      setProfile((prev) => ({ ...prev, avatar: prevAvatar }));
      showToast("Could not connect to server.", "error");
    } finally {
      setAvatarLoading(false);
      URL.revokeObjectURL(previewUrl);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    }
  };

  // ── Edit mode handlers ─────────────────────────────────────────────────────
  const enterEdit = () => { setFormDraft({ name: profile.name, phone: profile.phone }); setFormErrors({ name: "", phone: "" }); setEditMode(true); };
  const cancelEdit = () => { setFormErrors({ name: "", phone: "" }); setEditMode(false); };

  const saveAll = async () => {
    const errors = { name: "", phone: "" };
    const trimName = formDraft.name.trim();
    const trimPhone = formDraft.phone.trim();

    if (!trimName) errors.name = "Name is required.";
    else if (trimName.length < 2) errors.name = "Name must be at least 2 characters.";
    if (!trimPhone) errors.phone = "Phone number is required.";
    else if (!/^0[0-9]{9}$/.test(trimPhone)) errors.phone = "Invalid phone (e.g. 0905414132).";

    if (errors.name || errors.phone) { setFormErrors(errors); return; }
    setFormErrors({ name: "", phone: "" });

    const spaceIdx = trimName.lastIndexOf(" ");
    const firstName = spaceIdx > 0 ? trimName.slice(0, spaceIdx) : trimName;
    const lastName = spaceIdx > 0 ? trimName.slice(spaceIdx + 1) : "";
    const updated = { ...profile, name: trimName, phone: trimPhone, firstName, lastName };
    setProfile(updated);
    setEditMode(false);
    setToast({ msg: "Saving...", type: "saving" });

    const token = localStorage.getItem("accessToken");
    if (!token) { showToast("Not authenticated", "error"); return; }

    const { ok, data } = await apiFetch("/profile", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ firstName, lastName, phone: trimPhone }),
    });

    if (ok && data?.success) {
      const merged = { ...data.data, createdAt: profile.createdAt };
      setProfile(buildProfile(merged));
      sessionStorage.setItem("valo_user", JSON.stringify(merged));
      window.dispatchEvent(new Event("valo_auth_change"));
      setToast({ msg: "Profile updated ✓", type: "success" });
      setTimeout(() => setToast(null), 2000);
    } else {
      setProfile(profile);
      showToast(data?.message || "Update failed", "error");
    }
  };

  // ── Change Password handler ──────────────────────────────────────────────────
  const resetFp = () => {
    setFpStep(null);
    setFpOtpDigits(Array(6).fill(""));
    setFpVerifiedOTP("");
    setFpNewPwd("");
    setFpConfirmPwd("");
    setFpShow({ newPwd: false, confirm: false });
    setFpError("");
  };

  const closeCpModal = () => {
    setCpOpen(false);
    setCpForm({ current: "", newPwd: "", confirm: "" });
    setCpErrors({ current: "", newPwd: "", confirm: "" });
    setCpShow({ current: false, newPwd: false, confirm: false });
    resetFp();
  };

  const handleForgotClick = async () => {
    setFpError("");
    setFpLoading(true);
    const { ok, data } = await apiForgotPassword(profile.email);
    setFpLoading(false);
    if (!ok) { setFpError(data?.message || "Could not send OTP. Please try again."); return; }
    setFpOtpDigits(Array(6).fill(""));
    setFpStep("otp");
  };

  const handleFpResendOTP = async () => {
    setFpError("");
    setFpLoading(true);
    const { ok, data } = await apiForgotPassword(profile.email);
    setFpLoading(false);
    if (!ok) { setFpError(data?.message || "Could not resend OTP."); return; }
    setFpOtpDigits(Array(6).fill(""));
    showToast("New OTP sent ✓", "success");
  };

  const handleFpVerifyOTP = async () => {
    const code = fpOtpDigits.join("");
    if (code.length !== 6) { setFpError("Please enter all 6 digits."); return; }
    setFpError("");
    setFpLoading(true);
    const { ok, data } = await apiVerifyResetOTP(profile.email, code);
    setFpLoading(false);
    if (!ok) { setFpError(data?.message || "Invalid OTP. Please try again."); return; }
    setFpVerifiedOTP(code);
    setFpOtpDigits(Array(6).fill(""));
    setFpStep("password");
  };

  const handleFpReset = async () => {
    const checks = getPwdChecks(fpNewPwd);
    const strength = [checks.length, checks.cases, checks.number, checks.special].filter(Boolean).length;
    if (strength < 4) { setFpError("Password does not meet all requirements."); return; }
    if (fpNewPwd !== fpConfirmPwd) { setFpError("Passwords do not match."); return; }
    setFpError("");
    setFpLoading(true);
    const { ok, data } = await apiResetPassword(profile.email, fpVerifiedOTP, fpNewPwd);
    setFpLoading(false);
    if (!ok) { setFpError(data?.message || "Reset failed. Please try again."); return; }
    showToast("Password reset ✓", "success");
    closeCpModal();
  };

  const handleChangePwd = async () => {
    const { current, newPwd, confirm } = cpForm;
    const isGoogleUser = profile.isGoogleUser;
    const errs = { current: "", newPwd: "", confirm: "" };

    if (!isGoogleUser && !current.trim()) errs.current = "Current password is required.";
    if (!newPwd) errs.newPwd = "New password is required.";
    else if (newPwd.length < 8) errs.newPwd = "Minimum 8 characters required.";
    else if (!/[A-Z]/.test(newPwd) || !/[a-z]/.test(newPwd)) errs.newPwd = "Must contain both uppercase and lowercase letters.";
    else if (!/[0-9]/.test(newPwd)) errs.newPwd = "Must contain at least 1 number.";
    else if (!/[^a-zA-Z0-9]/.test(newPwd)) errs.newPwd = "Must contain at least 1 special character.";
    else if (!isGoogleUser && newPwd === current.trim()) errs.newPwd = "New password must differ from current password.";

    const strength = getPwdStrength(newPwd);
    if (strength === 4) {
      if (!confirm) errs.confirm = "Please confirm your new password.";
      else if (confirm !== newPwd) errs.confirm = "Passwords do not match.";
    }
    if (errs.current || errs.newPwd || errs.confirm) { setCpErrors(errs); return; }

    setCpRipple(true);
    setCpLockOpen(true);
    setTimeout(() => setCpRipple(false), 700);
    setTimeout(() => setCpLockOpen(false), 1200);
    setCpLoading(true);

    const token = localStorage.getItem("accessToken");
    const payload = isGoogleUser
      ? { newPassword: newPwd, confirmNewPassword: confirm }
      : { currentPassword: current, newPassword: newPwd, confirmNewPassword: confirm };

    const { ok, data } = await apiFetch("/profile/change-password", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    setCpLoading(false);

    if (ok && data?.success) { showToast("Password updated ✓", "success"); closeCpModal(); }
    else setCpErrors((p) => ({ ...p, current: data?.message || "Incorrect current password." }));
  };

  // ── Magnetic button handlers ───────────────────────────────────────────────
  const handleMagneticMove = (e) => {
    if (!magneticRef.current) return;
    const rect = magneticRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;
    magneticRef.current.style.transform = `translate(${x * 0.3}px, ${y * 0.3}px)`;
  };
  const handleMagneticLeave = () => {
    if (magneticRef.current) magneticRef.current.style.transform = "translate(0, 0)";
  };

  // ── Shared Staff accent: VALO gold ─────────────────────────────────────
  const ACCENT = "#ffd555";
  const ACCENT_DIM = "rgba(255,213,85,0.7)";
  const ACCENT_GLOW = "rgba(255,213,85,0.25)";
  const ACCENT_BG = "rgba(255,213,85,0.08)";
  const ACCENT_BORDER = "rgba(255,213,85,0.25)";
  const ACCENT_TEXT = "#ffe58a";

  // ── Gold Accent for Content Sections ─────────────────────────────────────
  const GOLD = "#EAB308";
  const GOLD_DIM = "rgba(234,179,8,0.7)";
  const GOLD_GLOW = "rgba(234,179,8,0.3)";
  const GOLD_BG = "rgba(234,179,8,0.08)";
  const GOLD_TEXT = "#ffdea8";

  // ───────────────────────────────────────────────────────────────────────────
  // RENDER
  // ───────────────────────────────────────────────────────────────────────────
  return (
    <div
      className="relative h-full flex flex-col overflow-hidden"
      style={{ backgroundColor: "#080808", fontFamily: "'Plus Jakarta Sans', 'Montserrat', sans-serif" }}
    >
      {/* ── Cursor spotlight ── */}
      <div
        ref={spotlightRef}
        className="fixed inset-0 pointer-events-none z-10"
        style={{ background: `radial-gradient(circle at var(--x, 50%) var(--y, 50%), ${ACCENT_BG} 0%, transparent 40%)` }}
      />

      {/* ── Emerald dust dot pattern ── */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ backgroundImage: `radial-gradient(circle at 1px 1px, ${ACCENT_BORDER} 1px, transparent 0)`, backgroundSize: "40px 40px" }}
      />

      {/* ════════════════════ HERO SECTION ════════════════════ */}
      <section className="relative flex items-center px-8 py-5 overflow-hidden flex-shrink-0">
        <div className="absolute inset-0 pointer-events-none" style={{ background: `radial-gradient(ellipse at 15% 60%, ${ACCENT_GLOW} 0%, transparent 55%)` }} />
        <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(to top, #080808 0%, transparent 60%)" }} />

        <div className="relative z-10 flex flex-col md:flex-row items-center md:items-end gap-10 w-full">
          {/* ── 3D Avatar Orb ── */}
          <div ref={orbRef} className="relative flex-shrink-0" style={{ width: 150, height: 150, perspective: "1000px", transition: "transform 0.1s ease-out" }}>
            <div className="absolute inset-0 rounded-full border border-[#ffd555]" style={{ opacity: 0.55, animation: "valo-rotateRing 8s linear infinite" }} />
            <div className="absolute rounded-full border" style={{ inset: "8px", borderColor: "#bbf7d0", opacity: 0.35, animation: "valo-rotateRing 5s linear infinite reverse" }} />

            <div className="w-full h-full rounded-full overflow-hidden" style={{ border: `2px solid ${ACCENT}`, padding: "3px", background: "#1a1b22", boxShadow: `0 0 36px ${ACCENT_GLOW}, 0 0 80px rgba(16,185,129,0.1)` }}>
              {profile.avatar ? (
                <img src={profile.avatar} alt={profile.name} className="w-full h-full rounded-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center rounded-full bg-[#ffd555] text-2xl font-extrabold text-[#080808]">
                  {getInitials(profile.name)}
                </div>
              )}
            </div>

            <label
              htmlFor="staff-avatar-upload"
              className="absolute inset-0 rounded-full flex flex-col items-center justify-center gap-1 transition-all duration-300 group"
              style={{ background: avatarLoading ? "rgba(0,0,0,0.65)" : "rgba(0,0,0,0)", cursor: avatarLoading ? "not-allowed" : "pointer" }}
              onMouseEnter={(e) => { if (!avatarLoading) e.currentTarget.style.background = "rgba(0,0,0,0.6)"; }}
              onMouseLeave={(e) => { if (!avatarLoading) e.currentTarget.style.background = "rgba(0,0,0,0)"; }}
            >
              {avatarLoading ? (
                <svg className="animate-spin" style={{ width: 28, height: 28, color: ACCENT }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <>
                  <Camera size={22} className="text-[#ffd555] opacity-0 transition-opacity group-hover:opacity-100" />
                  <span className="text-[9px] font-bold uppercase tracking-wider text-[#ffd555] opacity-0 transition-opacity group-hover:opacity-100">Change</span>
                </>
              )}
            </label>
            <input id="staff-avatar-upload" disabled={avatarLoading} ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />

            <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-500 rounded-full animate-ping" />
          </div>

          {/* ── Name & role ── */}
          <div className="flex-1 text-center md:text-left">
            <h2 className="text-3xl font-black leading-none" style={{ color: ACCENT_TEXT, textShadow: `0 4px 24px ${ACCENT_GLOW}` }}>
              {profile.name || "—"}
            </h2>
            <p className="mt-1.5 tracking-[0.15em] text-xs font-semibold uppercase" style={{ color: ACCENT_DIM }}>
              {profile.role}
            </p>
          </div>
        </div>
      </section>

      {/* ════════════════════ CONTENT GRID ════════════════════ */}
      <section className="px-8 py-8 grid grid-cols-12 gap-8 flex-1">
        {/* ── Left: Personal Records ── */}
        <div className="col-span-12 md:col-span-7">
          <h3 className="text-2xl font-bold mt-1 mb-10" style={{ color: "#ffdea8" }}>
            Personal Records
          </h3>

          {editMode ? (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="flex items-center gap-1 mb-1 tracking-[0.2em] text-[10px] font-semibold" style={{ color: "rgba(234,179,8,0.7)" }}>
                    <User size={10} /> NAME
                  </label>
                  <input
                    autoFocus
                    value={formDraft.name}
                    onChange={(e) => { setFormDraft((p) => ({ ...p, name: e.target.value })); if (formErrors.name) setFormErrors((p) => ({ ...p, name: "" })); }}
                    onKeyDown={(e) => e.key === "Enter" && saveAll()}
                    className="w-full bg-transparent pb-1.5 text-sm outline-none"
                    style={{ borderBottom: formErrors.name ? "1px solid rgba(239,68,68,0.7)" : `1px solid ${GOLD}`, color: "#e2e1eb" }}
                  />
                  {formErrors.name && <p className="mt-1 text-[10px] text-red-400">{formErrors.name}</p>}
                </div>
                <div>
                  <label className="flex items-center gap-1 mb-1 tracking-[0.2em] text-[10px] font-semibold" style={{ color: "rgba(234,179,8,0.7)" }}>
                    <Phone size={10} /> PHONE
                  </label>
                  <input
                    value={formDraft.phone}
                    onChange={(e) => { setFormDraft((p) => ({ ...p, phone: e.target.value })); if (formErrors.phone) setFormErrors((p) => ({ ...p, phone: "" })); }}
                    onKeyDown={(e) => e.key === "Enter" && saveAll()}
                    className="w-full bg-transparent pb-1.5 text-sm outline-none"
                    style={{ borderBottom: formErrors.phone ? "1px solid rgba(239,68,68,0.7)" : `1px solid ${GOLD}`, color: "#e2e1eb" }}
                  />
                  {formErrors.phone && <p className="mt-1 text-[10px] text-red-400">{formErrors.phone}</p>}
                </div>
              </div>
              <EmeraldUnderlineField field="email" label="EMAIL" icon={Mail} value={profile.email} readOnly onSave={() => {}} />
              <EmeraldUnderlineField
                field="createdAt" label="MEMBER SINCE" icon={CalendarDays}
                value={profile.createdAt ? new Date(profile.createdAt).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—"}
                readOnly onSave={() => {}}
              />
            </div>
          ) : (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-6">
                <EmeraldUnderlineField field="name" label="NAME" icon={User} value={profile.name} onSave={handleSaveProfile} />
                <EmeraldUnderlineField field="phone" label="PHONE" icon={Phone} value={profile.phone} onSave={handleSaveProfile} />
              </div>
              <EmeraldUnderlineField field="email" label="EMAIL" icon={Mail} value={profile.email} readOnly onSave={() => {}} />
              <EmeraldUnderlineField
                field="createdAt" label="MEMBER SINCE" icon={CalendarDays}
                value={profile.createdAt ? new Date(profile.createdAt).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—"}
                readOnly onSave={() => {}}
              />
            </div>
          )}

          {/* ── Edit Profile / Cancel + Save buttons ── */}
          <div className="pt-6 flex items-center gap-3">
            {editMode && (
              <button
                onClick={saveAll}
                className="px-6 py-2 rounded-full text-xs font-semibold tracking-wider transition-colors duration-200"
                style={{ background: GOLD, color: "#050505" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#CA8A04")}
                onMouseLeave={(e) => (e.currentTarget.style.background = GOLD)}
              >
                Save Changes
              </button>
            )}
            <button
              ref={magneticRef}
              onMouseMove={editMode ? undefined : handleMagneticMove}
              onMouseLeave={editMode ? undefined : handleMagneticLeave}
              onClick={editMode ? cancelEdit : enterEdit}
              className="group relative px-5 py-2 overflow-hidden rounded-full"
              style={{ border: editMode ? "1px solid rgba(234,179,8,0.6)" : `1px solid ${GOLD}`, transition: "transform 0.2s cubic-bezier(0.23,1,0.32,1)", background: "transparent" }}
            >
              <span className="relative z-10 font-semibold tracking-wider text-xs transition-colors duration-300" style={{ color: editMode ? "rgba(234,179,8,0.8)" : GOLD }}>
                {editMode ? "Cancel" : "Edit Profile"}
              </span>
              <div className="absolute inset-0 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" style={{ background: editMode ? "rgba(234,179,8,0.1)" : GOLD }} />
            </button>
          </div>
        </div>

        {/* ── Right: Security ── */}
        <div className="col-span-12 md:col-span-5">
          <h3 className="text-2xl font-bold mb-10" style={{ color: "#ffdea8" }}>Security</h3>

          {!cpOpen ? (
            <button
              onClick={() => setCpOpen(true)}
              className="flex items-center gap-2.5 px-5 py-2.5 rounded-full transition-all duration-300"
              style={{ border: `1px solid ${GOLD}`, background: "transparent" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = GOLD_BG; e.currentTarget.style.borderColor = GOLD; e.currentTarget.style.boxShadow = `0 0 16px ${GOLD_GLOW}`; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = GOLD; e.currentTarget.style.boxShadow = "none"; }}
            >
              <Key size={14} style={{ color: GOLD }} className="shrink-0" />
              <span className="font-semibold tracking-widest text-xs" style={{ color: GOLD_TEXT }}>Change Password</span>
            </button>
          ) : (
            (() => {
              const strength = getPwdStrength(cpForm.newPwd);
              const checks = getPwdChecks(cpForm.newPwd);
              const isGoogleUser = profile.isGoogleUser;
              const newDiffersFromCurrent = isGoogleUser || !cpForm.newPwd || cpForm.newPwd !== cpForm.current.trim();
              const cpIsValid = (isGoogleUser || !!cpForm.current.trim()) && strength === 4 && newDiffersFromCurrent && !!cpForm.confirm && cpForm.confirm === cpForm.newPwd;
              const fieldStyle = (hasError) => ({ width: "100%", background: "transparent", border: "none", borderBottom: hasError ? "1px solid rgba(239,68,68,0.7)" : `1px solid ${GOLD}`, padding: "8px 36px 8px 0", color: "#e2e1eb", fontSize: "13px", outline: "none", caretColor: GOLD, transition: "border-color 0.2s" });
              const onFocusEmerald = (e) => (e.currentTarget.style.borderColor = GOLD);
              const onBlurEmerald = (hasErr) => (e) => { e.currentTarget.style.borderColor = hasErr ? "rgba(239,68,68,0.7)" : GOLD; };
              const strengthColors = ["rgba(255,255,255,0.08)", "rgba(239,68,68,0.7)", "rgba(249,115,22,0.8)", "rgba(234,179,8,0.6)", GOLD];

              /* ── Forgot password: OTP step ── */
              if (fpStep === "otp")
                return (
                  <div className="space-y-6" style={{ animation: "cp-slideDown 0.3s ease-out" }}>
                    <div className="text-center">
                      <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3" style={{ background: GOLD_BG, border: `1px solid ${GOLD}` }}>
                        <Mail size={20} style={{ color: GOLD }} />
                      </div>
                      <p className="font-bold mb-1" style={{ color: GOLD_TEXT, fontSize: "14px" }}>Enter OTP</p>
                      <p style={{ color: "rgba(255,255,255,0.4)", fontSize: "11px" }}>
                        Code sent to <span style={{ color: GOLD }}>{profile.email}</span>
                      </p>
                    </div>
                    <div className="flex gap-2 justify-center">
                      {fpOtpDigits.map((digit, i) => (
                        <input key={i} ref={(el) => { fpOtpRefs.current[i] = el; }} type="text" inputMode="numeric" maxLength={6} value={digit}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (!/^\d*$/.test(val)) return;
                            if (val.length > 1) {
                              const digits = val.replace(/\D/g, "").slice(0, 6).split("");
                              const next = [...fpOtpDigits];
                              digits.forEach((d, j) => { if (i + j < 6) next[i + j] = d; });
                              setFpOtpDigits(next);
                              const focusIdx = Math.min(i + digits.length, 5);
                              setTimeout(() => fpOtpRefs.current[focusIdx]?.focus(), 0);
                              return;
                            }
                            const next = [...fpOtpDigits];
                            next[i] = val;
                            setFpOtpDigits(next);
                            if (val && i < 5) setTimeout(() => fpOtpRefs.current[i + 1]?.focus(), 0);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Backspace" && !fpOtpDigits[i] && i > 0) setTimeout(() => fpOtpRefs.current[i - 1]?.focus(), 0);
                            if (e.key === "ArrowLeft" && i > 0) fpOtpRefs.current[i - 1]?.focus();
                            if (e.key === "ArrowRight" && i < 5) fpOtpRefs.current[i + 1]?.focus();
                          }}
                          className="w-10 h-12 text-center text-lg font-bold rounded-lg outline-none transition-all duration-200"
                          style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${GOLD}`, color: "#e2e1eb", caretColor: GOLD }}
                          onFocus={(e) => (e.currentTarget.style.borderColor = GOLD)}
                          onBlur={(e) => (e.currentTarget.style.borderColor = GOLD)}
                        />
                      ))}
                    </div>
                    {fpError && <p className="text-[10px] text-red-400 text-center">{fpError}</p>}
                    <button onClick={handleFpVerifyOTP} disabled={fpLoading || fpOtpDigits.join("").length !== 6}
                      className="w-full flex items-center justify-center gap-2 rounded-full text-xs font-bold tracking-wider py-2.5 transition-all duration-300"
                      style={{ background: fpOtpDigits.join("").length === 6 ? GOLD : GOLD_BG, color: fpOtpDigits.join("").length === 6 ? "#050505" : GOLD_DIM, cursor: fpLoading || fpOtpDigits.join("").length !== 6 ? "not-allowed" : "pointer" }}
                    >
                      {fpLoading ? "Verifying…" : "Verify OTP"}
                    </button>
                    <div className="flex items-center justify-between">
                      <button type="button" onClick={() => setFpStep(null)} className="flex items-center gap-1 text-[11px] transition-colors" style={{ color: "rgba(255,255,255,0.3)" }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.65)")}
                        onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.3)")}
                      >
                        <ArrowLeft size={11} /> Back
                      </button>
                      <button type="button" onClick={handleFpResendOTP} disabled={fpLoading} className="text-[11px] font-semibold transition-colors disabled:opacity-40" style={{ color: GOLD_DIM }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = GOLD)}
                        onMouseLeave={(e) => (e.currentTarget.style.color = GOLD_DIM)}
                      >
                        <RotateCw size={10} className="inline mr-1" /> Resend OTP
                      </button>
                    </div>
                  </div>
                );

              /* ── Forgot password: new password step ── */
              if (fpStep === "password") {
                const fpChecks = getPwdChecks(fpNewPwd);
                const fpStrength = [fpChecks.length, fpChecks.cases, fpChecks.number, fpChecks.special].filter(Boolean).length;
                const fpFieldStyle = (hasErr) => ({ width: "100%", background: "transparent", border: "none", borderBottom: hasErr ? "1px solid rgba(239,68,68,0.7)" : `1px solid ${GOLD}`, padding: "8px 36px 8px 0", color: "#e2e1eb", fontSize: "13px", outline: "none", caretColor: GOLD, transition: "border-color 0.2s" });
                return (
                  <div className="space-y-6" style={{ animation: "cp-slideDown 0.3s ease-out" }}>
                    <div className="text-center">
                      <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3" style={{ background: GOLD_BG, border: `1px solid ${GOLD}` }}>
                        <Lock size={20} style={{ color: GOLD }} />
                      </div>
                      <p className="font-bold mb-1" style={{ color: GOLD_TEXT, fontSize: "14px" }}>Set New Password</p>
                      <p style={{ color: "rgba(255,255,255,0.4)", fontSize: "11px" }}>OTP verified. Choose a strong password.</p>
                    </div>
                    <div>
                      <label style={{ color: "rgba(234,179,8,0.7)", fontSize: "10px", fontWeight: 700, letterSpacing: "0.22em" }}>NEW PASSWORD</label>
                      <div className="relative mt-1.5">
                        <input type={fpShow.newPwd ? "text" : "password"} value={fpNewPwd} autoComplete="new-password" autoFocus onChange={(e) => { setFpNewPwd(e.target.value); setFpError(""); setFpConfirmPwd(""); }} style={fpFieldStyle(false)} onFocus={(e) => (e.currentTarget.style.borderColor = GOLD)} onBlur={(e) => (e.currentTarget.style.borderColor = GOLD)} />
                        <button type="button" onClick={() => setFpShow((p) => ({ ...p, newPwd: !p.newPwd }))} className="absolute right-6 top-1/2 -translate-y-1/2 text-gray-600 hover:text-yellow-500 transition-colors">
                          {fpShow.newPwd ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                        <Shield size={15} className="absolute right-0 top-1/2 -translate-y-1/2 transition-all duration-500" style={{ color: strengthColors[fpStrength], filter: fpStrength === 4 ? `drop-shadow(0 0 6px ${GOLD_GLOW})` : "none" }} />
                      </div>
                      {fpNewPwd && (<div className="flex gap-1 mt-2">{[1, 2, 3, 4].map((i) => (<div key={i} className="h-[2px] flex-1 rounded-full transition-all duration-400" style={{ background: fpStrength >= i ? strengthColors[fpStrength] : "rgba(255,255,255,0.08)" }} />))}</div>)}
                      <ul className="mt-2.5 space-y-1">
                        {[{ ok: fpChecks.length, label: "At least 8 characters" }, { ok: fpChecks.cases, label: "Uppercase & lowercase letters" }, { ok: fpChecks.number, label: "At least 1 number (0-9)" }, { ok: fpChecks.special, label: "At least 1 special character (!@#$...)" }].map(({ ok, label }) => (
                          <li key={label} className="flex items-center gap-1.5 transition-colors duration-300" style={{ color: ok ? GOLD : "rgba(255,255,255,0.22)", fontSize: "10px" }}>
                            {ok ? <Check size={9} style={{ flexShrink: 0 }} /> : <span style={{ width: 9, height: 9, display: "inline-block", borderRadius: "50%", border: "1px solid rgba(255,255,255,0.18)", flexShrink: 0 }} />}
                            {label}
                          </li>
                        ))}
                      </ul>
                    </div>
                    {fpStrength === 4 && (
                      <div style={{ animation: "cp-slideDown 0.35s cubic-bezier(0.22,1,0.36,1)" }}>
                        <label style={{ color: "rgba(234,179,8,0.7)", fontSize: "10px", fontWeight: 700, letterSpacing: "0.22em" }}>CONFIRM NEW PASSWORD</label>
                        <div className="relative mt-1.5">
                          <input type={fpShow.confirm ? "text" : "password"} value={fpConfirmPwd} autoComplete="new-password" autoFocus onChange={(e) => { setFpConfirmPwd(e.target.value); setFpError(""); }} style={fpFieldStyle(!!fpError && fpConfirmPwd !== fpNewPwd)} onFocus={(e) => (e.currentTarget.style.borderColor = GOLD)} onBlur={(e) => (e.currentTarget.style.borderColor = GOLD)} />
                          <button type="button" onClick={() => setFpShow((p) => ({ ...p, confirm: !p.confirm }))} className="absolute right-0 top-1/2 -translate-y-1/2 text-gray-600 hover:text-yellow-500 transition-colors">
                            {fpShow.confirm ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                        </div>
                        {fpConfirmPwd && fpConfirmPwd === fpNewPwd && (<p className="mt-1 text-[10px] text-green-400 flex items-center gap-1"><Check size={9} /> Passwords match</p>)}
                      </div>
                    )}
                    {fpError && <p className="text-[10px] text-red-400">{fpError}</p>}
                    <div className="flex items-center gap-3 pt-2">
                      <button onClick={handleFpReset} disabled={fpLoading || fpStrength < 4 || fpNewPwd !== fpConfirmPwd}
                        className="relative overflow-hidden flex items-center gap-2 px-6 py-2.5 rounded-full text-xs font-bold tracking-wider"
                        style={{ background: fpStrength === 4 && fpNewPwd === fpConfirmPwd && fpConfirmPwd ? GOLD : GOLD_BG, color: fpStrength === 4 && fpNewPwd === fpConfirmPwd && fpConfirmPwd ? "#050505" : GOLD_DIM, border: fpStrength === 4 && fpNewPwd === fpConfirmPwd && fpConfirmPwd ? "none" : `1px solid ${GOLD}`, cursor: fpLoading || fpStrength < 4 || fpNewPwd !== fpConfirmPwd ? "not-allowed" : "pointer", boxShadow: fpStrength === 4 && fpNewPwd === fpConfirmPwd && fpConfirmPwd ? `0 0 22px ${GOLD_GLOW}` : "none", transition: "all 0.3s" }}
                      >
                        <Lock size={13} />
                        <span>{fpLoading ? "Resetting…" : "Reset Password"}</span>
                      </button>
                      <button onClick={closeCpModal} className="px-5 py-2.5 rounded-full text-xs font-semibold tracking-wider transition-colors duration-200" style={{ border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.35)" }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.25)"; e.currentTarget.style.color = "rgba(255,255,255,0.65)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)"; e.currentTarget.style.color = "rgba(255,255,255,0.35)"; }}
                      >Cancel</button>
                    </div>
                  </div>
                );
              }

              /* ── Normal change-password form ── */
              return (
                <div className="space-y-6" style={{ animation: "cp-slideDown 0.3s ease-out" }}>
                  {isGoogleUser && (
                    <div className="flex items-start gap-2.5 rounded-xl px-4 py-3" style={{ background: GOLD_BG, border: `1px solid ${GOLD}` }}>
                      <Shield size={14} className="shrink-0 mt-0.5" style={{ color: GOLD }} />
                      <p style={{ color: "rgba(180,255,220,0.85)", fontSize: "11px", lineHeight: "1.5" }}>
                        Your account is linked to Google. You can set a password below to also enable standard login.
                      </p>
                    </div>
                  )}
                  {!isGoogleUser && (
                    <div>
                      <label style={{ color: "rgba(234,179,8,0.7)", fontSize: "10px", fontWeight: 700, letterSpacing: "0.22em" }}>CURRENT PASSWORD</label>
                      <div className="relative mt-1.5">
                        <input type={cpShow.current ? "text" : "password"} value={cpForm.current} autoComplete="current-password"
                          onChange={(e) => { setCpForm((p) => ({ ...p, current: e.target.value })); if (cpErrors.current) setCpErrors((p) => ({ ...p, current: "" })); }}
                          style={fieldStyle(!!cpErrors.current)} onFocus={onFocusEmerald} onBlur={onBlurEmerald(!!cpErrors.current)}
                        />
                        <button type="button" onClick={() => setCpShow((p) => ({ ...p, current: !p.current }))} className="absolute right-0 top-1/2 -translate-y-1/2 text-gray-600 hover:text-yellow-500 transition-colors">
                          {cpShow.current ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                      {cpErrors.current && <p className="mt-1 text-[10px] text-red-400">{cpErrors.current}</p>}
                      <button type="button" onClick={handleForgotClick} disabled={fpLoading} className="mt-1 text-[10px] transition-colors disabled:opacity-40" style={{ color: GOLD_DIM }}
                        onMouseEnter={(e) => !fpLoading && (e.currentTarget.style.color = GOLD)}
                        onMouseLeave={(e) => (e.currentTarget.style.color = GOLD_DIM)}
                      >
                        {fpLoading ? "Sending OTP…" : "Forgot current password?"}
                      </button>
                    </div>
                  )}
                  <div>
                    <label style={{ color: "rgba(234,179,8,0.7)", fontSize: "10px", fontWeight: 700, letterSpacing: "0.22em" }}>NEW PASSWORD</label>
                    <div className="relative mt-1.5">
                      <input type={cpShow.newPwd ? "text" : "password"} value={cpForm.newPwd} autoComplete="new-password"
                        onChange={(e) => { setCpForm((p) => ({ ...p, newPwd: e.target.value, confirm: "" })); if (cpErrors.newPwd) setCpErrors((p) => ({ ...p, newPwd: "", confirm: "" })); }}
                        style={{ ...fieldStyle(!!cpErrors.newPwd), paddingRight: "56px" }} onFocus={onFocusEmerald} onBlur={onBlurEmerald(!!cpErrors.newPwd)}
                      />
                      <button type="button" onClick={() => setCpShow((p) => ({ ...p, newPwd: !p.newPwd }))} className="absolute right-6 top-1/2 -translate-y-1/2 text-gray-600 hover:text-yellow-500 transition-colors">
                        {cpShow.newPwd ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                      <Shield size={15} className="absolute right-0 top-1/2 -translate-y-1/2 transition-all duration-500" style={{ color: strengthColors[strength], filter: strength === 4 ? `drop-shadow(0 0 6px ${GOLD_GLOW})` : "none", animation: strength === 4 ? "cp-shield-pulse 1.8s ease-in-out infinite" : "none" }} />
                    </div>
                    {cpForm.newPwd && (<div className="flex gap-1 mt-2">{[1, 2, 3, 4].map((i) => (<div key={i} className="h-[2px] flex-1 rounded-full transition-all duration-400" style={{ background: strength >= i ? strengthColors[strength] : "rgba(255,255,255,0.08)" }} />))}</div>)}
                    <ul className="mt-2.5 space-y-1">
                      {[{ ok: checks.length, label: "At least 8 characters" }, { ok: checks.cases, label: "Uppercase & lowercase letters" }, { ok: checks.number, label: "At least 1 number (0-9)" }, { ok: checks.special, label: "At least 1 special character (!@#$...)" }].map(({ ok, label }) => (
                        <li key={label} className="flex items-center gap-1.5 transition-colors duration-300" style={{ color: ok ? GOLD : "rgba(255,255,255,0.22)", fontSize: "10px" }}>
                          {ok ? <Check size={9} style={{ flexShrink: 0 }} /> : <span style={{ width: 9, height: 9, display: "inline-block", borderRadius: "50%", border: "1px solid rgba(255,255,255,0.18)", flexShrink: 0 }} />}
                          {label}
                        </li>
                      ))}
                      {!isGoogleUser && cpForm.newPwd && cpForm.current.trim() && cpForm.newPwd === cpForm.current.trim() && (
                        <li className="flex items-center gap-1.5" style={{ color: "rgba(239,68,68,0.9)", fontSize: "10px" }}>
                          <X size={9} style={{ flexShrink: 0 }} /> Must differ from current password
                        </li>
                      )}
                    </ul>
                    {cpErrors.newPwd && <p className="mt-0.5 text-[10px] text-red-400">{cpErrors.newPwd}</p>}
                  </div>
                  {strength === 4 && newDiffersFromCurrent && (
                    <div style={{ animation: "cp-slideDown 0.35s cubic-bezier(0.22,1,0.36,1)" }}>
                      <label style={{ color: "rgba(234,179,8,0.7)", fontSize: "10px", fontWeight: 700, letterSpacing: "0.22em" }}>CONFIRM NEW PASSWORD</label>
                      <div className="relative mt-1.5">
                        <input type={cpShow.confirm ? "text" : "password"} value={cpForm.confirm} autoComplete="new-password" autoFocus
                          onChange={(e) => { setCpForm((p) => ({ ...p, confirm: e.target.value })); if (cpErrors.confirm) setCpErrors((p) => ({ ...p, confirm: "" })); }}
                          style={fieldStyle(!!cpErrors.confirm)} onFocus={onFocusEmerald} onBlur={onBlurEmerald(!!cpErrors.confirm)}
                        />
                        <button type="button" onClick={() => setCpShow((p) => ({ ...p, confirm: !p.confirm }))} className="absolute right-0 top-1/2 -translate-y-1/2 text-gray-600 hover:text-yellow-500 transition-colors">
                          {cpShow.confirm ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                      {cpErrors.confirm && <p className="mt-1 text-[10px] text-red-400">{cpErrors.confirm}</p>}
                      {cpForm.confirm && cpForm.confirm === cpForm.newPwd && (<p className="mt-1 text-[10px] text-green-400 flex items-center gap-1"><Check size={9} /> Passwords match</p>)}
                    </div>
                  )}
                  <div className="flex items-center gap-3 pt-2">
                    <button onClick={handleChangePwd} disabled={!cpIsValid || cpLoading}
                      className="relative overflow-hidden flex items-center gap-2 px-6 py-2.5 rounded-full text-xs font-bold tracking-wider"
                      style={{ background: cpIsValid ? GOLD : GOLD_BG, color: cpIsValid ? "#050505" : GOLD_DIM, border: cpIsValid ? "none" : `1px solid ${GOLD}`, cursor: cpIsValid && !cpLoading ? "pointer" : "not-allowed", boxShadow: cpIsValid ? `0 0 22px ${GOLD_GLOW}` : "none", transition: "all 0.3s" }}
                    >
                      {cpRipple && (<span className="absolute inset-0 rounded-full pointer-events-none" style={{ background: "rgba(255,255,255,0.25)", animation: "cp-ripple 0.7s ease-out forwards", transformOrigin: "center" }} />)}
                      {cpLockOpen ? <LockOpen size={13} /> : <Lock size={13} />}
                      <span>{cpLoading ? "Updating…" : "Update Password"}</span>
                    </button>
                    <button onClick={closeCpModal} className="px-5 py-2.5 rounded-full text-xs font-semibold tracking-wider transition-colors duration-200" style={{ border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.35)" }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.25)"; e.currentTarget.style.color = "rgba(255,255,255,0.65)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)"; e.currentTarget.style.color = "rgba(255,255,255,0.35)"; }}
                    >Cancel</button>
                  </div>
                </div>
              );
            })()
          )}
        </div>
      </section>

      {/* ════════════════════ TOAST ════════════════════ */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-2.5 px-5 py-2.5 rounded-full text-sm font-semibold shadow-2xl backdrop-blur-md border transition-all duration-300 ${toast.type === "saving" ? "bg-yellow-500/15 text-yellow-300 border-yellow-500/30" : toast.type === "success" ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" : "bg-red-500/15 text-red-300 border-red-500/30"}`}>
          {toast.type === "saving" && (<div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0" />)}
          {toast.msg}
        </div>
      )}
    </div>
  );
}
