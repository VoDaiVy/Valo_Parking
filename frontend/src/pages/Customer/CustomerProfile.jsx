import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "../../i18n/hooks/useLanguage";
import { QRCodeSVG } from "qrcode.react";
import Logo from "../../assets/images/logo.png";
import { apiFetch, API_BASE } from "../../services/api";
import { getMembershipQr } from "../../services/subscriptionService";
import {
  forgotPassword as apiForgotPassword,
  verifyResetPasswordOTP as apiVerifyResetOTP,
  resetPassword as apiResetPassword,
} from "../../services/authService";
import {
  Camera,
  Check,
  Crown,
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
  Car,
  QrCode,
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
  return [c.length, c.cases, c.number, c.special].filter(Boolean).length; // 0-4
};

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
    role: raw.role || "Customer",
    wallet: raw.wallet || { balance: 0 },
    vehicles: raw.vehicles || [],
    membership: raw.membership || { isVip: false, expireAt: null, freeServiceCount: 0 },
    createdAt: raw.createdAt || null,
    isGoogleUser: !!raw.isGoogleUser,
  };
};

const getMembershipTier = (membership = {}) => {
  const expireAt = membership.expireAt ? new Date(membership.expireAt) : null;
  const isActiveVip =
    membership.isVip && (!expireAt || Number.isNaN(expireAt.getTime()) || expireAt > new Date());

  if (!isActiveVip) return "member";
  if (membership.packageType === "yearly") return "yearly";
  if (membership.packageType === "monthly") return "monthly";
  return "monthly";
};

const avatarThemes = {
  monthly: {
    ringClass: "border-yellow-400 shadow-[0_0_34px_rgba(250,204,21,0.55)]",
    innerRingClass: "border-yellow-100 shadow-[inset_0_0_18px_rgba(254,240,138,0.45)]",
    avatarClass: "ring-[4px] ring-yellow-400/80 animate-vip-ripple",
    badgeClass: "from-yellow-400 via-amber-300 to-gold text-[#181C23] shadow-gold/25",
    label: "VIP",
    orbBackground:
      "linear-gradient(135deg, rgba(234,179,8,0.34), rgba(120,53,15,0.4), rgba(0,0,0,0.92))",
    halo:
      "conic-gradient(from 0deg, transparent 0deg, rgba(250,204,21,0.95) 72deg, rgba(255,237,213,0.9) 112deg, transparent 176deg, rgba(245,158,11,0.7) 250deg, transparent 360deg)",
    spark: "#facc15",
    glow: "rgba(250,204,21,0.66)",
    rippleStrong: "rgba(251, 191, 36, 0.7)",
    rippleSoft: "rgba(251, 191, 36, 0.3)",
    rippleFaint: "rgba(251, 191, 36, 0.1)",
    rippleClear: "rgba(251, 191, 36, 0)",
    innerGlow: "rgba(234, 179, 8, 0.3)",
  },
  yearly: {
    ringClass: "border-purple-300 shadow-[0_0_42px_rgba(168,85,247,0.72)]",
    innerRingClass: "border-fuchsia-100 shadow-[inset_0_0_22px_rgba(216,180,254,0.48)]",
    avatarClass: "ring-[4px] ring-purple-400/90 animate-vip-ripple",
    badgeClass: "from-purple-400 via-fuchsia-300 to-violet-500 text-white shadow-purple-500/30",
    label: "NOVA",
    orbBackground:
      "linear-gradient(135deg, rgba(168,85,247,0.42), rgba(217,70,239,0.28), rgba(8,7,18,0.96))",
    halo:
      "conic-gradient(from 0deg, transparent 0deg, rgba(168,85,247,1) 60deg, rgba(244,114,182,0.92) 108deg, transparent 178deg, rgba(129,140,248,0.9) 262deg, transparent 360deg)",
    spark: "#c084fc",
    glow: "rgba(168,85,247,0.78)",
    rippleStrong: "rgba(168, 85, 247, 0.72)",
    rippleSoft: "rgba(168, 85, 247, 0.32)",
    rippleFaint: "rgba(217, 70, 239, 0.13)",
    rippleClear: "rgba(168, 85, 247, 0)",
    innerGlow: "rgba(168, 85, 247, 0.32)",
  },
};

// ─── Gold underline editable field ───────────────────────────────────────────
function GoldUnderlineField({
  field,
  label,
  value,
  readOnly = false,
  onSave,
  icon: Icon,
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const save = () => {
    onSave(field, draft);
    setIsEditing(false);
  };
  const cancel = () => {
    setDraft(value);
    setIsEditing(false);
  };

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
        <p
          className="w-full pb-1.5 text-sm"
          style={{
            borderBottom: "1px solid rgba(255,255,255,0.15)",
            color: "#e2e1eb",
          }}
        >
          {value || "—"}
        </p>
      ) : isEditing ? (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") cancel();
            }}
            className="flex-1 bg-transparent pb-1.5 text-sm outline-none"
            style={{
              borderBottom: "1px solid #EAB308",
              color: "#e2e1eb",
            }}
          />
          <button
            onClick={save}
            className="shrink-0 transition-colors text-emerald-400 hover:text-emerald-300"
          >
            <Check size={15} />
          </button>
          <button
            onClick={cancel}
            className="shrink-0 transition-colors text-red-400 hover:text-red-300"
          >
            <X size={15} />
          </button>
        </div>
      ) : (
        <div
          className="flex items-center gap-2 pb-1.5 transition-all duration-300"
          style={{
            borderBottom: "1px solid rgba(255,255,255,0.15)",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.borderBottomColor = "rgba(234,179,8,0.5)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.borderBottomColor = "rgba(255,255,255,0.15)")
          }
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
export default function CustomerProfile() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const avatarInputRef = useRef(null);
  const spotlightRef = useRef(null);
  const orbRef = useRef(null);
  const magneticRef = useRef(null);
  const fpOtpRefs = useRef([]);
  const [membershipQrOpen, setMembershipQrOpen] = useState(false);
  const [membershipQr, setMembershipQr] = useState("");
  const [membershipQrLoading, setMembershipQrLoading] = useState(false);
  const [membershipQrError, setMembershipQrError] = useState("");

  // ── Profile state ──────────────────────────────────────────────────────────
  const [profile, setProfile] = useState({
    name: "",
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    avatar: "",
    role: "Customer",
    wallet: { balance: 0 },
    vehicles: [],
    membership: { isVip: false, expireAt: null, freeServiceCount: 0 },
    createdAt: null,
    isGoogleUser: false,
  });
  const [toast, setToast] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [formDraft, setFormDraft] = useState({ name: "", phone: "" });
  const [formErrors, setFormErrors] = useState({ name: "", phone: "" });

  // ── Change Password modal state ────────────────────────────────────────────
  const [cpOpen, setCpOpen] = useState(false);
  const [cpForm, setCpForm] = useState({
    current: "",
    newPwd: "",
    confirm: "",
  });
  const [cpShow, setCpShow] = useState({
    current: false,
    newPwd: false,
    confirm: false,
  });
  const [cpErrors, setCpErrors] = useState({
    current: "",
    newPwd: "",
    confirm: "",
  });
  const [cpLoading, setCpLoading] = useState(false);
  const [cpRipple, setCpRipple] = useState(false);
  const [cpLockOpen, setCpLockOpen] = useState(false);
  const [avatarLoading, setAvatarLoading] = useState(false);

  // ── Forgot current password sub-flow ──────────────────────────────────────
  // fpStep: null | 'otp' | 'password'
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
        // Flatten avatar to top-level so Navbar can read user.avatar directly
        sessionStorage.setItem(
          "valo_user",
          JSON.stringify({
            ...data.data,
            avatar: data.data.profile?.avatar || "",
          }),
        );
        window.dispatchEvent(new Event("valo_auth_change"));

        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get("membershipPayment") === "success") {
          setToast({
            msg: "VIP package activated and your parking slot has been reserved.",
            type: "success",
          });
          window.history.replaceState({}, document.title, window.location.pathname);
          window.setTimeout(() => setToast(null), 3500);
        }
      }
    };
    fetchUserData();
  }, []);

  useEffect(() => {
    const subscriptionId = profile.membership?.subscriptionId;
    const expireAt = profile.membership?.expireAt
      ? new Date(profile.membership.expireAt)
      : null;
    const membershipIsActive =
      profile.membership?.isVip &&
      subscriptionId &&
      (!expireAt || Number.isNaN(expireAt.getTime()) || expireAt > new Date());

    if (!membershipIsActive) {
      return undefined;
    }

    let cancelled = false;
    const fetchMembershipQr = async () => {
      setMembershipQrLoading(true);
      setMembershipQrError("");
      try {
        const response = await getMembershipQr(subscriptionId);
        if (cancelled) return;

        if (response.ok && response.data?.success && response.data.data?.available) {
          setMembershipQr(response.data.data.payload);
        } else {
          setMembershipQr("");
          setMembershipQrError(
            response.data?.message || "Membership QR is currently unavailable.",
          );
        }
      } catch {
        if (!cancelled) {
          setMembershipQr("");
          setMembershipQrError("Unable to load membership QR.");
        }
      } finally {
        if (!cancelled) setMembershipQrLoading(false);
      }
    };

    fetchMembershipQr();
    return () => {
      cancelled = true;
    };
  }, [
    profile.membership?.expireAt,
    profile.membership?.isVip,
    profile.membership?.subscriptionId,
  ]);

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
    if (!token) {
      showToast("Not authenticated", "error");
      return;
    }

    const { ok, data } = await apiFetch("/profile", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        firstName: updated.firstName,
        lastName: updated.lastName,
        phone: updated.phone,
      }),
    });

    if (ok && data?.success) {
      const merged = { ...data.data, createdAt: profile.createdAt };
      const fresh = buildProfile(merged);
      setProfile(fresh);
      sessionStorage.setItem("valo_user", JSON.stringify(merged));
      window.dispatchEvent(new Event("valo_auth_change"));
      if (data.data.claimedSessions > 0) {
        setToast({ msg: "🎉 Success! We've collected your full parking history!", type: "success" });
      } else {
        setToast({ msg: "Profile updated ✓", type: "success" });
      }
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

    if (file.size > 5 * 1024 * 1024) {
      showToast("Image must be under 5 MB.", "error");
      return;
    }

    // Instant preview while uploading
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
        const cached = JSON.parse(
          sessionStorage.getItem("valo_user") || "null",
        );
        if (cached) {
          sessionStorage.setItem(
            "valo_user",
            JSON.stringify({ ...cached, avatar: cloudinaryUrl }),
          );
        }
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
  const enterEdit = () => {
    setFormDraft({ name: profile.name, phone: profile.phone });
    setFormErrors({ name: "", phone: "" });
    setEditMode(true);
  };

  const cancelEdit = () => {
    setFormErrors({ name: "", phone: "" });
    setEditMode(false);
  };

  const saveAll = async () => {
    const errors = { name: "", phone: "" };
    const trimName = formDraft.name.trim();
    const trimPhone = formDraft.phone.trim();

    if (!trimName) errors.name = "Name is required.";
    else if (trimName.length < 2)
      errors.name = "Name must be at least 2 characters.";
    if (!trimPhone) errors.phone = "Phone number is required.";
    else if (!/^0[0-9]{9}$/.test(trimPhone))
      errors.phone = "Invalid phone (e.g. 0905414132).";

    if (errors.name || errors.phone) {
      setFormErrors(errors);
      return;
    }
    setFormErrors({ name: "", phone: "" });

    const spaceIdx = trimName.lastIndexOf(" ");
    const firstName = spaceIdx > 0 ? trimName.slice(0, spaceIdx) : trimName;
    const lastName = spaceIdx > 0 ? trimName.slice(spaceIdx + 1) : "";
    const updated = {
      ...profile,
      name: trimName,
      phone: trimPhone,
      firstName,
      lastName,
    };
    setProfile(updated);
    setEditMode(false);
    setToast({ msg: "Saving...", type: "saving" });

    const token = localStorage.getItem("accessToken");
    if (!token) {
      showToast("Not authenticated", "error");
      return;
    }

    const { ok, data } = await apiFetch("/profile", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ firstName, lastName, phone: trimPhone }),
    });

    if (ok && data?.success) {
      const merged = { ...data.data, createdAt: profile.createdAt };
      const fresh = buildProfile(merged);
      setProfile(fresh);
      sessionStorage.setItem("valo_user", JSON.stringify(merged));
      window.dispatchEvent(new Event("valo_auth_change"));
      if (data.data.claimedSessions > 0) {
        setToast({ msg: "🎉 Success! We've collected your full parking history!", type: "success" });
      } else {
        setToast({ msg: "Profile updated ✓", type: "success" });
      }
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
    if (!ok) {
      setFpError(data?.message || "Could not send OTP. Please try again.");
      return;
    }
    setFpOtpDigits(Array(6).fill(""));
    setFpStep("otp");
  };

  const handleFpResendOTP = async () => {
    setFpError("");
    setFpLoading(true);
    const { ok, data } = await apiForgotPassword(profile.email);
    setFpLoading(false);
    if (!ok) {
      setFpError(data?.message || "Could not resend OTP.");
      return;
    }
    setFpOtpDigits(Array(6).fill(""));
    showToast("New OTP sent ✓", "success");
  };

  const handleFpVerifyOTP = async () => {
    const code = fpOtpDigits.join("");
    if (code.length !== 6) {
      setFpError("Please enter all 6 digits.");
      return;
    }
    setFpError("");
    setFpLoading(true);
    const { ok, data } = await apiVerifyResetOTP(profile.email, code);
    setFpLoading(false);
    if (!ok) {
      setFpError(data?.message || "Invalid OTP. Please try again.");
      return;
    }
    setFpVerifiedOTP(code);
    setFpOtpDigits(Array(6).fill(""));
    setFpStep("password");
  };

  const handleFpReset = async () => {
    const checks = getPwdChecks(fpNewPwd);
    const strength = [
      checks.length,
      checks.cases,
      checks.number,
      checks.special,
    ].filter(Boolean).length;
    if (strength < 4) {
      setFpError("Password does not meet all requirements.");
      return;
    }
    if (fpNewPwd !== fpConfirmPwd) {
      setFpError("Passwords do not match.");
      return;
    }
    setFpError("");
    setFpLoading(true);
    const { ok, data } = await apiResetPassword(
      profile.email,
      fpVerifiedOTP,
      fpNewPwd,
    );
    setFpLoading(false);
    if (!ok) {
      setFpError(data?.message || "Reset failed. Please try again.");
      return;
    }
    showToast("Password reset ✓", "success");
    closeCpModal();
  };

  const handleChangePwd = async () => {
    const { current, newPwd, confirm } = cpForm;
    const isGoogleUser = profile.isGoogleUser;
    const errs = { current: "", newPwd: "", confirm: "" };

    // Only validate current password for non-Google users
    if (!isGoogleUser && !current.trim())
      errs.current = "Current password is required.";

    if (!newPwd) errs.newPwd = "New password is required.";
    else if (newPwd.length < 8) errs.newPwd = "Minimum 8 characters required.";
    else if (!/[A-Z]/.test(newPwd) || !/[a-z]/.test(newPwd))
      errs.newPwd = "Must contain both uppercase and lowercase letters.";
    else if (!/[0-9]/.test(newPwd))
      errs.newPwd = "Must contain at least 1 number.";
    else if (!/[^a-zA-Z0-9]/.test(newPwd))
      errs.newPwd = "Must contain at least 1 special character.";
    else if (!isGoogleUser && newPwd === current.trim())
      errs.newPwd = "New password must differ from current password.";

    const strength = getPwdStrength(newPwd);
    if (strength === 4) {
      if (!confirm) errs.confirm = "Please confirm your new password.";
      else if (confirm !== newPwd) errs.confirm = "Passwords do not match.";
    }
    if (errs.current || errs.newPwd || errs.confirm) {
      setCpErrors(errs);
      return;
    }

    setCpRipple(true);
    setCpLockOpen(true);
    setTimeout(() => setCpRipple(false), 700);
    setTimeout(() => setCpLockOpen(false), 1200);
    setCpLoading(true);

    const token = localStorage.getItem("accessToken");
    const payload = isGoogleUser
      ? { newPassword: newPwd, confirmNewPassword: confirm }
      : {
        currentPassword: current,
        newPassword: newPwd,
        confirmNewPassword: confirm,
      };

    const { ok, data } = await apiFetch("/profile/change-password", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    setCpLoading(false);

    if (ok && data?.success) {
      showToast("Password updated ✓", "success");
      closeCpModal();
    } else {
      setCpErrors((p) => ({
        ...p,
        current: data?.message || "Incorrect current password.",
      }));
    }
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
    if (magneticRef.current)
      magneticRef.current.style.transform = "translate(0, 0)";
  };

  const membershipTier = getMembershipTier(profile.membership);
  const avatarTheme = avatarThemes[membershipTier];
  const isVip = Boolean(avatarTheme);

  // ───────────────────────────────────────────────────────────────────────────
  // RENDER
  // ───────────────────────────────────────────────────────────────────────────
  return (
    <div
      className="relative h-full flex flex-col overflow-hidden"
      style={{
        backgroundColor: "#050505",
        fontFamily: "'Plus Jakarta Sans', 'Montserrat', sans-serif",
      }}
    >
      {/* ── Cursor spotlight ── */}
      <div
        ref={spotlightRef}
        className="fixed inset-0 pointer-events-none z-10"
        style={{
          background:
            "radial-gradient(circle at var(--x, 50%) var(--y, 50%), rgba(255,184,0,0.07) 0%, transparent 40%)",
        }}
      />

      {/* ── Gold dust dot pattern ── */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(234,179,8,0.08) 1px, transparent 0)",
          backgroundSize: "40px 40px",
        }}
      />

      {/* ════════════════════ HERO SECTION ════════════════════ */}
      <section className="relative flex items-center px-8 py-5 overflow-hidden flex-shrink-0">
        {/* Ambient glow */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse at 15% 60%, rgba(255,184,0,0.18) 0%, transparent 55%)",
          }}
        />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: "linear-gradient(to top, #050505 0%, transparent 60%)",
          }}
        />

        <div className="relative z-10 flex flex-col md:flex-row items-center md:items-end gap-10 w-full">
          {/* ── 3D Avatar Orb ── */}
          <div
            ref={orbRef}
            className="relative flex-shrink-0"
            style={{
              width: 150,
              height: 150,
              perspective: "1000px",
              transition: "transform 0.1s ease-out",
            }}
          >
            {/* Outer rotating ring */}
            <div
              className={`absolute inset-0 rounded-full border ${isVip ? avatarTheme.ringClass : 'border-gray-600'}`}
              style={{
                opacity: isVip ? 0.9 : 0.3,
                animation: "valo-rotateRing 8s linear infinite",
              }}
            />
            {/* Inner rotating ring */}
            <div
              className={`absolute rounded-full border ${isVip ? avatarTheme.innerRingClass : 'border-gray-500'}`}
              style={{
                inset: "8px",
                opacity: isVip ? 0.75 : 0.2,
                animation: "valo-rotateRing 5s linear infinite reverse",
              }}
            />

            {isVip && (
              <div
                className="absolute inset-[-7px] rounded-full blur-[2px] opacity-80 animate-avatar-halo"
                style={{ background: avatarTheme.halo }}
              />
            )}

            {/* Avatar sphere */}
            <div
              className={`relative w-full h-full rounded-full overflow-hidden transition-all duration-500 ${isVip
                ? avatarTheme.avatarClass
                : 'border-2 border-gray-700 shadow-[0_0_20px_rgba(255,255,255,0.02)]'
                }`}
              style={{
                padding: isVip ? "6px" : "3px",
                background: isVip ? avatarTheme.orbBackground : "#1a1b22",
                "--vip-glow": avatarTheme?.glow,
                "--vip-inner-glow": avatarTheme?.innerGlow,
                "--vip-ripple-strong": avatarTheme?.rippleStrong,
                "--vip-ripple-soft": avatarTheme?.rippleSoft,
                "--vip-ripple-faint": avatarTheme?.rippleFaint,
                "--vip-ripple-clear": avatarTheme?.rippleClear,
              }}
            >
              {profile.avatar ? (
                <img
                  src={profile.avatar}
                  alt={profile.name}
                  className="w-full h-full rounded-full object-cover"
                />
              ) : (
                <div className="w-full h-full rounded-full bg-white flex items-center justify-center">
                  <img src={Logo} alt="VALO" className="w-[60%] h-[60%] object-contain" />
                </div>
              )}
            </div>

            {/* Hover upload overlay — shows spinner when uploading */}
            <label
              htmlFor="avatar-upload"
              className="absolute inset-0 rounded-full flex flex-col items-center justify-center gap-1 transition-all duration-300 group"
              style={{
                background: avatarLoading
                  ? "rgba(0,0,0,0.65)"
                  : "rgba(0,0,0,0)",
                cursor: avatarLoading ? "not-allowed" : "pointer",
              }}
              onMouseEnter={(e) => {
                if (!avatarLoading)
                  e.currentTarget.style.background = "rgba(0,0,0,0.6)";
              }}
              onMouseLeave={(e) => {
                if (!avatarLoading)
                  e.currentTarget.style.background = "rgba(0,0,0,0)";
              }}
            >
              {avatarLoading ? (
                <svg
                  className="animate-spin"
                  style={{ width: 28, height: 28, color: "#EAB308" }}
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
              ) : (
                <>
                  <Camera
                    size={22}
                    className="text-yellow-400 opacity-0 group-hover:opacity-100 transition-opacity"
                  />
                  <span className="text-yellow-400 text-[9px] font-bold tracking-wider uppercase opacity-0 group-hover:opacity-100 transition-opacity">
                    Change
                  </span>
                </>
              )}
            </label>
            <input
              id="avatar-upload"
              disabled={avatarLoading}
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarChange}
            />

            {/* Spark dot - Only for VIP */}
            {isVip && (
              <>
                <div
                  className="absolute -top-1 -right-1 w-3 h-3 rounded-full animate-ping"
                  style={{
                    backgroundColor: avatarTheme.spark,
                    boxShadow: `0 0 12px ${avatarTheme.spark}`,
                  }}
                />
                <div
                  className="absolute bottom-2 left-2 w-2 h-2 rounded-full animate-avatar-spark"
                  style={{
                    backgroundColor: avatarTheme.spark,
                    boxShadow: `0 0 10px ${avatarTheme.spark}`,
                  }}
                />
              </>
            )}
          </div>

          <div className="flex-1 text-center md:text-left">
            <h2
              className="text-3xl font-black leading-none flex items-center justify-center md:justify-start gap-3"
              style={{
                color: "#ffdea8",
                textShadow: "0 4px 24px rgba(255,184,0,0.45)",
              }}
            >
              {profile.name || "—"}
              {isVip && (
                <span className={`bg-gradient-to-r ${avatarTheme.badgeClass} text-xs px-2.5 py-1 rounded-md uppercase tracking-wider shadow-lg flex items-center gap-1 font-black`}>
                  <Crown size={12} /> {avatarTheme.label}
                </span>
              )}
            </h2>
            <p
              className="mt-1.5 tracking-[0.15em] text-xs font-semibold uppercase"
              style={{ color: "rgba(234,179,8,0.65)" }}
            >
              {profile.role}
            </p>
          </div>
        </div>
      </section>

      {/* ════════════════════ CONTENT GRID ════════════════════ */}
      <section className="scrollbar-hidden px-8 py-8 grid grid-cols-12 gap-8 flex-1 overflow-y-auto">
        {/* ── VIP Pass Banner (Full Width) ── */}
        {isVip && profile.membership?.reservedSlots?.length > 0 && (
          <div className="col-span-12">
            <div
              className="rounded-2xl p-6 lg:p-8 border relative overflow-hidden flex flex-col md:flex-row items-center justify-between gap-6 shadow-xl"
              style={{
                background: "linear-gradient(135deg, rgba(30,25,10,0.8) 0%, rgba(10,8,4,0.9) 100%)",
                borderColor: "rgba(234, 179, 8, 0.4)",
              }}
            >
              {/* Subtle background effects */}
              <div className="absolute inset-0 pointer-events-none" style={{
                background: "linear-gradient(105deg, transparent 20%, rgba(255,220,120,0.05) 25%, transparent 30%, transparent 40%, rgba(255,220,120,0.02) 45%, transparent 50%)"
              }} />
              <div className="absolute right-0 top-1/2 -translate-y-1/2 p-4 opacity-5 pointer-events-none">
                <Crown size={200} />
              </div>

              {/* Left: Branding & Info */}
              <div className="relative z-10 flex items-center gap-5 md:w-1/3">
                <div className="p-4 rounded-full bg-gradient-to-br from-yellow-400 to-yellow-600 shadow-[0_0_20px_rgba(234,179,8,0.3)]">
                  <Crown size={28} className="text-black" />
                </div>
                <div>
                  <h4 className="text-yellow-400 font-black tracking-widest text-xl mb-1" style={{ textShadow: "0 2px 4px rgba(0,0,0,0.8)" }}>{t('profilePage.vipPass')}</h4>
                  <p className="text-[11px] text-yellow-500/70 font-semibold uppercase tracking-widest">{t('profilePage.activeFixedSlots')}</p>
                </div>
              </div>

              {/* Middle: Slots list */}
              <div className="relative z-10 flex gap-4 overflow-x-auto custom-scrollbar flex-1 justify-center md:justify-start px-4 border-l border-r border-yellow-500/10">
                {profile.membership.reservedSlots.map((slot, idx) => (
                  <div key={idx} className="flex-shrink-0 flex items-center gap-3 bg-black/40 border border-yellow-500/20 rounded-xl px-5 py-3 shadow-[0_0_15px_rgba(234,179,8,0.05)]">
                    <div>
                      <p className="text-[9px] text-yellow-500/60 tracking-widest font-bold uppercase">{slot.floorName}</p>
                      <p className="text-xl font-black text-yellow-300 tracking-widest" style={{ fontFamily: "monospace", letterSpacing: "0.1em" }}>{slot.slotNumber}</p>
                    </div>
                    <Car size={24} className="text-yellow-500/30" />
                  </div>
                ))}
              </div>

              {/* Right: Expiration & Action */}
              <div className="relative z-10 flex flex-col items-center md:items-end gap-3 md:w-1/4">
                <button
                  type="button"
                  onClick={() => setMembershipQrOpen(true)}
                  disabled={membershipQrLoading || !membershipQr}
                  className="inline-flex items-center gap-2 text-[11px] bg-yellow-400 text-black px-6 py-2.5 rounded-full font-black hover:bg-yellow-300 transition-all uppercase tracking-wider shadow-[0_0_18px_rgba(234,179,8,0.25)] hover:shadow-[0_0_28px_rgba(234,179,8,0.4)] hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0"
                >
                  <QrCode size={15} />
                  {membershipQrLoading ? t('profilePage.loadingQr') : membershipQr ? t('profilePage.showQr') : t('profilePage.qrUnavailable')}
                </button>
                {membershipQrError && (
                  <p className="max-w-52 text-center text-[10px] leading-4 text-red-300 md:text-right">
                    {membershipQrError}
                  </p>
                )}
                {profile.membership.expireAt && (
                  <button
                    onClick={() => navigate("/customer/membership-transfers")}
                    className="text-[11px] bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 px-6 py-2.5 rounded-full font-bold hover:bg-yellow-500/20 transition-all uppercase tracking-wider shadow-[0_0_15px_rgba(234,179,8,0.15)] hover:shadow-[0_0_25px_rgba(234,179,8,0.3)] hover:-translate-y-0.5"
                  >
                    {t('profilePage.renewPass')}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Left: Personal Records ── */}
        <div className="col-span-12 md:col-span-7">


          {!profile.phone && !editMode && (
            <div
              className="mb-8 rounded-2xl p-5 border cursor-pointer transition-all duration-300 hover:scale-[1.02]"
              style={{ background: "rgba(234, 179, 8, 0.1)", borderColor: "rgba(234, 179, 8, 0.3)" }}
              onClick={enterEdit}
            >
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-xl bg-yellow-500/20 text-yellow-400">
                  <Phone size={24} />
                </div>
                <div>
                  <h4 className="text-yellow-400 font-bold text-[0px] mb-1">
                    <span className="text-base">{t('profilePage.parkingPrompt')}</span>
                    🎁 Have you parked at ValoParking before?
                  </h4>
                  <p className="text-sm text-yellow-500/80 leading-relaxed">
                    {t('profilePage.parkingPromptHint')}
                  </p>
                </div>
              </div>
            </div>
          )}

          <h3
            className="text-2xl font-bold mt-1 mb-10"
            style={{ color: "#ffdea8" }}
          >
            {t('profilePage.personalRecords')}
          </h3>

          {editMode ? (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label
                    className="flex items-center gap-1 mb-1 tracking-[0.2em] text-[10px] font-semibold"
                    style={{ color: "rgba(234,179,8,0.7)" }}
                  >
                    <User size={10} /> {t('profilePage.name')}
                  </label>
                  <input
                    autoFocus
                    value={formDraft.name}
                    onChange={(e) => {
                      setFormDraft((p) => ({ ...p, name: e.target.value }));
                      if (formErrors.name)
                        setFormErrors((p) => ({ ...p, name: "" }));
                    }}
                    onKeyDown={(e) => e.key === "Enter" && saveAll()}
                    className="w-full bg-transparent pb-1.5 text-sm outline-none"
                    style={{
                      borderBottom: formErrors.name
                        ? "1px solid rgba(239,68,68,0.7)"
                        : "1px solid #EAB308",
                      color: "#e2e1eb",
                    }}
                  />
                  {formErrors.name && (
                    <p className="mt-1 text-[10px] text-red-400">
                      {formErrors.name}
                    </p>
                  )}
                </div>
                <div>
                  <label
                    className="flex items-center gap-1 mb-1 tracking-[0.2em] text-[10px] font-semibold"
                    style={{ color: "rgba(234,179,8,0.7)" }}
                  >
                    <Phone size={10} /> {t('profilePage.phone')}
                  </label>
                  <input
                    value={formDraft.phone}
                    onChange={(e) => {
                      setFormDraft((p) => ({ ...p, phone: e.target.value }));
                      if (formErrors.phone)
                        setFormErrors((p) => ({ ...p, phone: "" }));
                    }}
                    onKeyDown={(e) => e.key === "Enter" && saveAll()}
                    className="w-full bg-transparent pb-1.5 text-sm outline-none"
                    style={{
                      borderBottom: formErrors.phone
                        ? "1px solid rgba(239,68,68,0.7)"
                        : "1px solid #EAB308",
                      color: "#e2e1eb",
                    }}
                  />
                  {formErrors.phone && (
                    <p className="mt-1 text-[10px] text-red-400">
                      {formErrors.phone}
                    </p>
                  )}
                </div>
              </div>
              <GoldUnderlineField
                field="email"
                label={t('profilePage.email')}
                icon={Mail}
                value={profile.email}
                readOnly
                onSave={() => { }}
              />
              <GoldUnderlineField
                field="createdAt"
                label={t('profilePage.memberSince')}
                icon={CalendarDays}
                value={
                  profile.createdAt
                    ? new Date(profile.createdAt).toLocaleDateString("vi-VN", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                    })
                    : "—"
                }
                readOnly
                onSave={() => { }}
              />
            </div>
          ) : (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-6">
                <GoldUnderlineField
                  field="name"
                  label="NAME"
                  icon={User}
                  value={profile.name}
                  onSave={handleSaveProfile}
                />
                <GoldUnderlineField
                  field="phone"
                  label="PHONE"
                  icon={Phone}
                  value={profile.phone}
                  onSave={handleSaveProfile}
                />
              </div>
              <GoldUnderlineField
                field="email"
                label="EMAIL"
                icon={Mail}
                value={profile.email}
                readOnly
                onSave={() => { }}
              />
              <GoldUnderlineField
                field="createdAt"
                label="MEMBER SINCE"
                icon={CalendarDays}
                value={
                  profile.createdAt
                    ? new Date(profile.createdAt).toLocaleDateString("vi-VN", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                    })
                    : "—"
                }
                readOnly
                onSave={() => { }}
              />
            </div>
          )}

          {/* ── Edit Profile / Cancel + Save buttons ── */}
          <div className="pt-6 flex items-center gap-3">
            {editMode && (
              <button
                onClick={saveAll}
                className="px-6 py-2 rounded-full text-xs font-semibold tracking-wider transition-colors duration-200"
                style={{ background: "#EAB308", color: "#050505" }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "#fbbf24")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "#EAB308")
                }
              >
                  {t('profilePage.saveChanges')}
              </button>
            )}
            <button
              ref={magneticRef}
              onMouseMove={editMode ? undefined : handleMagneticMove}
              onMouseLeave={editMode ? undefined : handleMagneticLeave}
              onClick={editMode ? cancelEdit : enterEdit}
              className="group relative px-5 py-2 overflow-hidden rounded-full"
              style={{
                border: editMode
                  ? "1px solid rgba(239,68,68,0.6)"
                  : "1px solid #EAB308",
                transition: "transform 0.2s cubic-bezier(0.23,1,0.32,1)",
                background: "transparent",
              }}
            >
              <span
                className="relative z-10 font-semibold tracking-wider text-xs transition-colors duration-300"
                style={{ color: editMode ? "rgba(239,68,68,0.8)" : "#EAB308" }}
              >
                {editMode ? t('profilePage.cancel') : t('profilePage.editProfile')}
              </span>
              <div
                className="absolute inset-0 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out"
                style={{
                  background: editMode ? "rgba(239,68,68,0.1)" : "#EAB308",
                }}
              />
            </button>
          </div>
        </div>

        {/* ── Right: Security + Cards ── */}
        <div className="col-span-12 md:col-span-5">
          <h3 className="text-2xl font-bold mb-10" style={{ color: "#ffdea8" }}>
            {t('profilePage.security')}
          </h3>

          {!cpOpen ? (
            /* Change Password button */
            <button
              onClick={() => setCpOpen(true)}
              className="flex items-center gap-2.5 px-5 py-2.5 rounded-full transition-all duration-300"
              style={{
                border: "1px solid rgba(234,179,8,0.4)",
                background: "transparent",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255,184,0,0.1)";
                e.currentTarget.style.borderColor = "#EAB308";
                e.currentTarget.style.boxShadow =
                  "0 0 16px rgba(255,184,0,0.12)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.borderColor = "rgba(234,179,8,0.4)";
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              <Key size={14} className="text-yellow-500 shrink-0" />
              <span
                className="font-semibold tracking-widest text-xs"
                style={{ color: "#ffdea8" }}
              >
                {t('profilePage.changePassword')}
              </span>
            </button>
          ) : (
            (() => {
              const strength = getPwdStrength(cpForm.newPwd);
              const checks = getPwdChecks(cpForm.newPwd);
              const isGoogleUser = profile.isGoogleUser;
              const newDiffersFromCurrent =
                isGoogleUser ||
                !cpForm.newPwd ||
                cpForm.newPwd !== cpForm.current.trim();
              const cpIsValid =
                (isGoogleUser || !!cpForm.current.trim()) &&
                strength === 4 &&
                newDiffersFromCurrent &&
                !!cpForm.confirm &&
                cpForm.confirm === cpForm.newPwd;
              const fieldStyle = (hasError) => ({
                width: "100%",
                background: "transparent",
                border: "none",
                borderBottom: hasError
                  ? "1px solid rgba(239,68,68,0.7)"
                  : "1px solid #EAB308",
                padding: "8px 36px 8px 0",
                color: "#e2e1eb",
                fontSize: "13px",
                outline: "none",
                caretColor: "#EAB308",
                transition: "border-color 0.2s",
              });
              const onFocusGold = (e) =>
                (e.currentTarget.style.borderColor = "#EAB308");
              const onBlurGold = (hasErr) => (e) => {
                e.currentTarget.style.borderColor = hasErr
                  ? "rgba(239,68,68,0.7)"
                  : "#EAB308";
              };
              const strengthColors = [
                "rgba(255,255,255,0.08)",
                "rgba(239,68,68,0.7)",
                "rgba(249,115,22,0.8)",
                "rgba(234,179,8,0.6)",
                "#EAB308",
              ];

              /* ── Forgot password: OTP step ──────────────────────── */
              if (fpStep === "otp")
                return (
                  <div
                    className="space-y-6"
                    style={{ animation: "cp-slideDown 0.3s ease-out" }}
                  >
                    {/* Header */}
                    <div className="text-center">
                      <div
                        className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3"
                        style={{
                          background: "rgba(234,179,8,0.08)",
                          border: "1px solid rgba(234,179,8,0.2)",
                        }}
                      >
                        <Mail size={20} style={{ color: "#EAB308" }} />
                      </div>
                      <p
                        className="font-bold mb-1"
                        style={{ color: "#ffdea8", fontSize: "14px" }}
                      >
                        Enter OTP
                      </p>
                      <p
                        style={{
                          color: "rgba(255,255,255,0.4)",
                          fontSize: "11px",
                        }}
                      >
                        Code sent to{" "}
                        <span style={{ color: "#EAB308" }}>
                          {profile.email}
                        </span>
                      </p>
                    </div>
                    {/* 6-digit boxes */}
                    <div className="flex gap-2 justify-center">
                      {fpOtpDigits.map((digit, i) => (
                        <input
                          key={i}
                          ref={(el) => {
                            fpOtpRefs.current[i] = el;
                          }}
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          value={digit}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (!/^\d*$/.test(val)) return;
                            if (val.length > 1) {
                              const digits = val
                                .replace(/\D/g, "")
                                .slice(0, 6)
                                .split("");
                              const next = [...fpOtpDigits];
                              digits.forEach((d, j) => {
                                if (i + j < 6) next[i + j] = d;
                              });
                              setFpOtpDigits(next);
                              const focusIdx = Math.min(i + digits.length, 5);
                              setTimeout(
                                () => fpOtpRefs.current[focusIdx]?.focus(),
                                0,
                              );
                              return;
                            }
                            const next = [...fpOtpDigits];
                            next[i] = val;
                            setFpOtpDigits(next);
                            if (val && i < 5)
                              setTimeout(
                                () => fpOtpRefs.current[i + 1]?.focus(),
                                0,
                              );
                          }}
                          onKeyDown={(e) => {
                            if (
                              e.key === "Backspace" &&
                              !fpOtpDigits[i] &&
                              i > 0
                            )
                              setTimeout(
                                () => fpOtpRefs.current[i - 1]?.focus(),
                                0,
                              );
                            if (e.key === "ArrowLeft" && i > 0)
                              fpOtpRefs.current[i - 1]?.focus();
                            if (e.key === "ArrowRight" && i < 5)
                              fpOtpRefs.current[i + 1]?.focus();
                          }}
                          className="w-10 h-12 text-center text-lg font-bold rounded-lg outline-none transition-all duration-200"
                          style={{
                            background: "rgba(255,255,255,0.04)",
                            border: "1px solid #EAB308",
                            color: "#e2e1eb",
                            caretColor: "#EAB308",
                          }}
                          onFocus={(e) =>
                            (e.currentTarget.style.borderColor = "#EAB308")
                          }
                          onBlur={(e) =>
                          (e.currentTarget.style.borderColor =
                            "#EAB308")
                          }
                        />
                      ))}
                    </div>
                    {fpError && (
                      <p className="text-[10px] text-red-400 text-center">
                        {fpError}
                      </p>
                    )}
                    {/* Verify button */}
                    <button
                      onClick={handleFpVerifyOTP}
                      disabled={fpLoading || fpOtpDigits.join("").length !== 6}
                      className="w-full flex items-center justify-center gap-2 rounded-full text-xs font-bold tracking-wider py-2.5 transition-all duration-300"
                      style={{
                        background:
                          fpOtpDigits.join("").length === 6
                            ? "#EAB308"
                            : "rgba(234,179,8,0.12)",
                        color:
                          fpOtpDigits.join("").length === 6
                            ? "#050505"
                            : "rgba(234,179,8,0.35)",
                        cursor:
                          fpLoading || fpOtpDigits.join("").length !== 6
                            ? "not-allowed"
                            : "pointer",
                      }}
                    >
                      {fpLoading ? "Verifying…" : "Verify OTP"}
                    </button>
                    {/* Actions row */}
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => setFpStep(null)}
                        className="flex items-center gap-1 text-[11px] transition-colors"
                        style={{ color: "rgba(255,255,255,0.3)" }}
                        onMouseEnter={(e) =>
                        (e.currentTarget.style.color =
                          "rgba(255,255,255,0.65)")
                        }
                        onMouseLeave={(e) =>
                        (e.currentTarget.style.color =
                          "rgba(255,255,255,0.3)")
                        }
                      >
                        <ArrowLeft size={11} /> Back
                      </button>
                      <button
                        type="button"
                        onClick={handleFpResendOTP}
                        disabled={fpLoading}
                        className="text-[11px] font-semibold transition-colors disabled:opacity-40"
                        style={{ color: "rgba(234,179,8,0.6)" }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.color = "#EAB308")
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.color = "rgba(234,179,8,0.6)")
                        }
                      >
                        <RotateCw size={10} className="inline mr-1" />
                        Resend OTP
                      </button>
                    </div>
                  </div>
                );

              /* ── Forgot password: new password step ───────────────── */
              if (fpStep === "password") {
                const fpChecks = getPwdChecks(fpNewPwd);
                const fpStrength = [
                  fpChecks.length,
                  fpChecks.cases,
                  fpChecks.number,
                  fpChecks.special,
                ].filter(Boolean).length;
                const fpStrengthColors = [
                  "rgba(255,255,255,0.08)",
                  "rgba(239,68,68,0.7)",
                  "rgba(249,115,22,0.8)",
                  "rgba(234,179,8,0.6)",
                  "#EAB308",
                ];
                const fpFieldStyle = (hasErr) => ({
                  width: "100%",
                  background: "transparent",
                  border: "none",
                  borderBottom: hasErr
                    ? "1px solid rgba(239,68,68,0.7)"
                    : "1px solid rgba(234,179,8,0.3)",
                  padding: "8px 36px 8px 0",
                  color: "#e2e1eb",
                  fontSize: "13px",
                  outline: "none",
                  caretColor: "#EAB308",
                  transition: "border-color 0.2s",
                });
                return (
                  <div
                    className="space-y-6"
                    style={{ animation: "cp-slideDown 0.3s ease-out" }}
                  >
                    {/* Header */}
                    <div className="text-center">
                      <div
                        className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3"
                        style={{
                          background: "rgba(234,179,8,0.08)",
                          border: "1px solid rgba(234,179,8,0.2)",
                        }}
                      >
                        <Lock size={20} style={{ color: "#EAB308" }} />
                      </div>
                      <p
                        className="font-bold mb-1"
                        style={{ color: "#ffdea8", fontSize: "14px" }}
                      >
                        Set New Password
                      </p>
                      <p
                        style={{
                          color: "rgba(255,255,255,0.4)",
                          fontSize: "11px",
                        }}
                      >
                        OTP verified. Choose a strong password.
                      </p>
                    </div>
                    {/* New password */}
                    <div>
                      <label
                        style={{
                          color: "rgba(234,179,8,0.65)",
                          fontSize: "10px",
                          fontWeight: 700,
                          letterSpacing: "0.22em",
                        }}
                      >
                        NEW PASSWORD
                      </label>
                      <div className="relative mt-1.5">
                        <input
                          type={fpShow.newPwd ? "text" : "password"}
                          value={fpNewPwd}
                          autoComplete="new-password"
                          autoFocus
                          onChange={(e) => {
                            setFpNewPwd(e.target.value);
                            setFpError("");
                            setFpConfirmPwd("");
                          }}
                          style={fpFieldStyle(false)}
                          onFocus={(e) =>
                            (e.currentTarget.style.borderColor = "#EAB308")
                          }
                          onBlur={(e) =>
                          (e.currentTarget.style.borderColor =
                            "rgba(234,179,8,0.3)")
                          }
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setFpShow((p) => ({ ...p, newPwd: !p.newPwd }))
                          }
                          className="absolute right-6 top-1/2 -translate-y-1/2 text-gray-600 hover:text-yellow-400 transition-colors"
                        >
                          {fpShow.newPwd ? (
                            <EyeOff size={14} />
                          ) : (
                            <Eye size={14} />
                          )}
                        </button>
                        <Shield
                          size={15}
                          className="absolute right-0 top-1/2 -translate-y-1/2 transition-all duration-500"
                          style={{
                            color: fpStrengthColors[fpStrength],
                            filter:
                              fpStrength === 4
                                ? "drop-shadow(0 0 6px rgba(255,184,0,0.9))"
                                : "none",
                          }}
                        />
                      </div>
                      {/* Strength bars */}
                      {fpNewPwd && (
                        <div className="flex gap-1 mt-2">
                          {[1, 2, 3, 4].map((i) => (
                            <div
                              key={i}
                              className="h-[2px] flex-1 rounded-full transition-all duration-400"
                              style={{
                                background:
                                  fpStrength >= i
                                    ? fpStrengthColors[fpStrength]
                                    : "rgba(255,255,255,0.08)",
                              }}
                            />
                          ))}
                        </div>
                      )}
                      {/* Checklist */}
                      <ul className="mt-2.5 space-y-1">
                        {[
                          {
                            ok: fpChecks.length,
                            label: "At least 8 characters",
                          },
                          {
                            ok: fpChecks.cases,
                            label: "Uppercase & lowercase letters",
                          },
                          {
                            ok: fpChecks.number,
                            label: "At least 1 number (0-9)",
                          },
                          {
                            ok: fpChecks.special,
                            label: "At least 1 special character (!@#$...)",
                          },
                        ].map(({ ok, label }) => (
                          <li
                            key={label}
                            className="flex items-center gap-1.5 transition-colors duration-300"
                            style={{
                              color: ok ? "#EAB308" : "rgba(255,255,255,0.22)",
                              fontSize: "10px",
                            }}
                          >
                            {ok ? (
                              <Check size={9} style={{ flexShrink: 0 }} />
                            ) : (
                              <span
                                style={{
                                  width: 9,
                                  height: 9,
                                  display: "inline-block",
                                  borderRadius: "50%",
                                  border: "1px solid rgba(255,255,255,0.18)",
                                  flexShrink: 0,
                                }}
                              />
                            )}
                            {label}
                          </li>
                        ))}
                      </ul>
                    </div>
                    {/* Confirm — only when strength 4 */}
                    {fpStrength === 4 && (
                      <div
                        style={{
                          animation:
                            "cp-slideDown 0.35s cubic-bezier(0.22,1,0.36,1)",
                        }}
                      >
                        <label
                          style={{
                            color: "rgba(234,179,8,0.65)",
                            fontSize: "10px",
                            fontWeight: 700,
                            letterSpacing: "0.22em",
                          }}
                        >
                          CONFIRM NEW PASSWORD
                        </label>
                        <div className="relative mt-1.5">
                          <input
                            type={fpShow.confirm ? "text" : "password"}
                            value={fpConfirmPwd}
                            autoComplete="new-password"
                            autoFocus
                            onChange={(e) => {
                              setFpConfirmPwd(e.target.value);
                              setFpError("");
                            }}
                            style={fpFieldStyle(
                              !!fpError && fpConfirmPwd !== fpNewPwd,
                            )}
                            onFocus={(e) =>
                              (e.currentTarget.style.borderColor = "#EAB308")
                            }
                            onBlur={(e) =>
                            (e.currentTarget.style.borderColor =
                              "#EAB308")
                            }
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setFpShow((p) => ({ ...p, confirm: !p.confirm }))
                            }
                            className="absolute right-0 top-1/2 -translate-y-1/2 text-gray-600 hover:text-yellow-400 transition-colors"
                          >
                            {fpShow.confirm ? (
                              <EyeOff size={14} />
                            ) : (
                              <Eye size={14} />
                            )}
                          </button>
                        </div>
                        {fpConfirmPwd && fpConfirmPwd === fpNewPwd && (
                          <p className="mt-1 text-[10px] text-green-400 flex items-center gap-1">
                            <Check size={9} /> Passwords match
                          </p>
                        )}
                      </div>
                    )}
                    {fpError && (
                      <p className="text-[10px] text-red-400">{fpError}</p>
                    )}
                    {/* Actions */}
                    <div className="flex items-center gap-3 pt-2">
                      <button
                        onClick={handleFpReset}
                        disabled={
                          fpLoading ||
                          fpStrength < 4 ||
                          fpNewPwd !== fpConfirmPwd
                        }
                        className="relative overflow-hidden flex items-center gap-2 px-6 py-2.5 rounded-full text-xs font-bold tracking-wider"
                        style={{
                          background:
                            fpStrength === 4 &&
                              fpNewPwd === fpConfirmPwd &&
                              fpConfirmPwd
                              ? "#EAB308"
                              : "rgba(234,179,8,0.12)",
                          color:
                            fpStrength === 4 &&
                              fpNewPwd === fpConfirmPwd &&
                              fpConfirmPwd
                              ? "#050505"
                              : "rgba(234,179,8,0.35)",
                          border:
                            fpStrength === 4 &&
                              fpNewPwd === fpConfirmPwd &&
                              fpConfirmPwd
                              ? "none"
                              : "1px solid #EAB308",
                          cursor:
                            fpLoading ||
                              fpStrength < 4 ||
                              fpNewPwd !== fpConfirmPwd
                              ? "not-allowed"
                              : "pointer",
                          boxShadow:
                            fpStrength === 4 &&
                              fpNewPwd === fpConfirmPwd &&
                              fpConfirmPwd
                              ? "0 0 22px rgba(234,179,8,0.35)"
                              : "none",
                          transition: "all 0.3s",
                        }}
                      >
                        <Lock size={13} />
                        <span>
                          {fpLoading ? "Resetting…" : "Reset Password"}
                        </span>
                      </button>
                      <button
                        onClick={closeCpModal}
                        className="px-5 py-2.5 rounded-full text-xs font-semibold tracking-wider transition-colors duration-200"
                        style={{
                          border: "1px solid rgba(255,255,255,0.1)",
                          color: "rgba(255,255,255,0.35)",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor =
                            "rgba(255,255,255,0.25)";
                          e.currentTarget.style.color =
                            "rgba(255,255,255,0.65)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor =
                            "rgba(255,255,255,0.1)";
                          e.currentTarget.style.color =
                            "rgba(255,255,255,0.35)";
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                );
              }

              /* ── Normal change-password form ──────────────────────── */
              return (
                <div
                  className="space-y-6"
                  style={{ animation: "cp-slideDown 0.3s ease-out" }}
                >
                  {/* Google user notice */}
                  {isGoogleUser && (
                    <div
                      className="flex items-start gap-2.5 rounded-xl px-4 py-3"
                      style={{
                        background: "rgba(234,179,8,0.07)",
                        border: "1px solid rgba(234,179,8,0.2)",
                      }}
                    >
                      <Shield
                        size={14}
                        className="shrink-0 mt-0.5"
                        style={{ color: "#EAB308" }}
                      />
                      <p
                        style={{
                          color: "rgba(255,220,120,0.85)",
                          fontSize: "11px",
                          lineHeight: "1.5",
                        }}
                      >
                        Your account is linked to Google. You can set a password
                        below to also enable standard login.
                      </p>
                    </div>
                  )}

                  {/* Current Password — hidden for Google users */}
                  {!isGoogleUser && (
                    <div>
                      <label
                        style={{
                          color: "rgba(234,179,8,0.65)",
                          fontSize: "10px",
                          fontWeight: 700,
                          letterSpacing: "0.22em",
                        }}
                      >
                        CURRENT PASSWORD
                      </label>
                      <div className="relative mt-1.5">
                        <input
                          type={cpShow.current ? "text" : "password"}
                          value={cpForm.current}
                          autoComplete="current-password"
                          onChange={(e) => {
                            setCpForm((p) => ({
                              ...p,
                              current: e.target.value,
                            }));
                            if (cpErrors.current)
                              setCpErrors((p) => ({ ...p, current: "" }));
                          }}
                          style={fieldStyle(!!cpErrors.current)}
                          onFocus={onFocusGold}
                          onBlur={onBlurGold(!!cpErrors.current)}
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setCpShow((p) => ({ ...p, current: !p.current }))
                          }
                          className="absolute right-0 top-1/2 -translate-y-1/2 text-gray-600 hover:text-yellow-400 transition-colors"
                        >
                          {cpShow.current ? (
                            <EyeOff size={14} />
                          ) : (
                            <Eye size={14} />
                          )}
                        </button>
                      </div>
                      {cpErrors.current && (
                        <p className="mt-1 text-[10px] text-red-400">
                          {cpErrors.current}
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={handleForgotClick}
                        disabled={fpLoading}
                        className="mt-1 text-[10px] transition-colors disabled:opacity-40"
                        style={{ color: "rgba(234,179,8,0.35)" }}
                        onMouseEnter={(e) =>
                          !fpLoading &&
                          (e.currentTarget.style.color = "rgba(234,179,8,0.8)")
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.color = "rgba(234,179,8,0.35)")
                        }
                      >
                        {fpLoading
                          ? "Sending OTP…"
                          : "Forgot current password?"}
                      </button>
                    </div>
                  )}
                  {/* New Password */}
                  <div>
                    <label
                      style={{
                        color: "rgba(234,179,8,0.65)",
                        fontSize: "10px",
                        fontWeight: 700,
                        letterSpacing: "0.22em",
                      }}
                    >
                      NEW PASSWORD
                    </label>
                    <div className="relative mt-1.5">
                      <input
                        type={cpShow.newPwd ? "text" : "password"}
                        value={cpForm.newPwd}
                        autoComplete="new-password"
                        onChange={(e) => {
                          setCpForm((p) => ({
                            ...p,
                            newPwd: e.target.value,
                            confirm: "",
                          }));
                          if (cpErrors.newPwd)
                            setCpErrors((p) => ({
                              ...p,
                              newPwd: "",
                              confirm: "",
                            }));
                        }}
                        style={{
                          ...fieldStyle(!!cpErrors.newPwd),
                          paddingRight: "56px",
                        }}
                        onFocus={onFocusGold}
                        onBlur={onBlurGold(!!cpErrors.newPwd)}
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setCpShow((p) => ({ ...p, newPwd: !p.newPwd }))
                        }
                        className="absolute right-6 top-1/2 -translate-y-1/2 text-gray-600 hover:text-yellow-400 transition-colors"
                      >
                        {cpShow.newPwd ? (
                          <EyeOff size={14} />
                        ) : (
                          <Eye size={14} />
                        )}
                      </button>
                      <Shield
                        size={15}
                        className="absolute right-0 top-1/2 -translate-y-1/2 transition-all duration-500"
                        style={{
                          color: strengthColors[strength],
                          filter:
                            strength === 4
                              ? "drop-shadow(0 0 6px rgba(255,184,0,0.9))"
                              : "none",
                          animation:
                            strength === 4
                              ? "cp-shield-pulse 1.8s ease-in-out infinite"
                              : "none",
                        }}
                      />
                    </div>
                    {/* Strength bars */}
                    {cpForm.newPwd && (
                      <div className="flex gap-1 mt-2">
                        {[1, 2, 3, 4].map((i) => (
                          <div
                            key={i}
                            className="h-[2px] flex-1 rounded-full transition-all duration-400"
                            style={{
                              background:
                                strength >= i
                                  ? strengthColors[strength]
                                  : "rgba(255,255,255,0.08)",
                            }}
                          />
                        ))}
                      </div>
                    )}
                    {/* Interactive checklist */}
                    <ul className="mt-2.5 space-y-1">
                      {[
                        { ok: checks.length, label: "At least 8 characters" },
                        {
                          ok: checks.cases,
                          label: "Uppercase & lowercase letters",
                        },
                        { ok: checks.number, label: "At least 1 number (0-9)" },
                        {
                          ok: checks.special,
                          label: "At least 1 special character (!@#$...)",
                        },
                      ].map(({ ok, label }) => (
                        <li
                          key={label}
                          className="flex items-center gap-1.5 transition-colors duration-300"
                          style={{
                            color: ok ? "#EAB308" : "rgba(255,255,255,0.22)",
                            fontSize: "10px",
                          }}
                        >
                          {ok ? (
                            <Check size={9} style={{ flexShrink: 0 }} />
                          ) : (
                            <span
                              style={{
                                width: 9,
                                height: 9,
                                display: "inline-block",
                                borderRadius: "50%",
                                border: "1px solid rgba(255,255,255,0.18)",
                                flexShrink: 0,
                              }}
                            />
                          )}
                          {label}
                        </li>
                      ))}
                      {!isGoogleUser &&
                        cpForm.newPwd &&
                        cpForm.current.trim() &&
                        cpForm.newPwd === cpForm.current.trim() && (
                          <li
                            className="flex items-center gap-1.5"
                            style={{
                              color: "rgba(239,68,68,0.9)",
                              fontSize: "10px",
                            }}
                          >
                            <X size={9} style={{ flexShrink: 0 }} />
                            Must differ from current password
                          </li>
                        )}
                    </ul>
                    {cpErrors.newPwd && (
                      <p className="mt-0.5 text-[10px] text-red-400">
                        {cpErrors.newPwd}
                      </p>
                    )}
                  </div>
                  {/* Confirm Password - slides in when all 4 criteria met */}
                  {strength === 4 && newDiffersFromCurrent && (
                    <div
                      style={{
                        animation:
                          "cp-slideDown 0.35s cubic-bezier(0.22,1,0.36,1)",
                      }}
                    >
                      <label
                        style={{
                          color: "rgba(234,179,8,0.65)",
                          fontSize: "10px",
                          fontWeight: 700,
                          letterSpacing: "0.22em",
                        }}
                      >
                        CONFIRM NEW PASSWORD
                      </label>
                      <div className="relative mt-1.5">
                        <input
                          type={cpShow.confirm ? "text" : "password"}
                          value={cpForm.confirm}
                          autoComplete="new-password"
                          autoFocus
                          onChange={(e) => {
                            setCpForm((p) => ({
                              ...p,
                              confirm: e.target.value,
                            }));
                            if (cpErrors.confirm)
                              setCpErrors((p) => ({ ...p, confirm: "" }));
                          }}
                          style={fieldStyle(!!cpErrors.confirm)}
                          onFocus={onFocusGold}
                          onBlur={onBlurGold(!!cpErrors.confirm)}
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setCpShow((p) => ({ ...p, confirm: !p.confirm }))
                          }
                          className="absolute right-0 top-1/2 -translate-y-1/2 text-gray-600 hover:text-yellow-400 transition-colors"
                        >
                          {cpShow.confirm ? (
                            <EyeOff size={14} />
                          ) : (
                            <Eye size={14} />
                          )}
                        </button>
                      </div>
                      {cpErrors.confirm && (
                        <p className="mt-1 text-[10px] text-red-400">
                          {cpErrors.confirm}
                        </p>
                      )}
                      {cpForm.confirm && cpForm.confirm === cpForm.newPwd && (
                        <p className="mt-1 text-[10px] text-green-400 flex items-center gap-1">
                          <Check size={9} /> Passwords match
                        </p>
                      )}
                    </div>
                  )}
                  {/* Actions */}
                  <div className="flex items-center gap-3 pt-2">
                    <button
                      onClick={handleChangePwd}
                      disabled={!cpIsValid || cpLoading}
                      className="relative overflow-hidden flex items-center gap-2 px-6 py-2.5 rounded-full text-xs font-bold tracking-wider"
                      style={{
                        background: cpIsValid
                          ? "#EAB308"
                          : "rgba(234,179,8,0.12)",
                        color: cpIsValid ? "#050505" : "rgba(234,179,8,0.35)",
                        border: cpIsValid
                          ? "none"
                          : "1px solid rgba(234,179,8,0.15)",
                        cursor:
                          cpIsValid && !cpLoading ? "pointer" : "not-allowed",
                        boxShadow: cpIsValid
                          ? "0 0 22px rgba(234,179,8,0.35)"
                          : "none",
                        transition: "all 0.3s",
                      }}
                    >
                      {cpRipple && (
                        <span
                          className="absolute inset-0 rounded-full pointer-events-none"
                          style={{
                            background: "rgba(255,255,255,0.25)",
                            animation: "cp-ripple 0.7s ease-out forwards",
                            transformOrigin: "center",
                          }}
                        />
                      )}
                      {cpLockOpen ? <LockOpen size={13} /> : <Lock size={13} />}
                      <span>{cpLoading ? "Updating…" : "Update Password"}</span>
                    </button>
                    <button
                      onClick={closeCpModal}
                      className="px-5 py-2.5 rounded-full text-xs font-semibold tracking-wider transition-colors duration-200"
                      style={{
                        border: "1px solid rgba(255,255,255,0.1)",
                        color: "rgba(255,255,255,0.35)",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor =
                          "rgba(255,255,255,0.25)";
                        e.currentTarget.style.color = "rgba(255,255,255,0.65)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor =
                          "rgba(255,255,255,0.1)";
                        e.currentTarget.style.color = "rgba(255,255,255,0.35)";
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              );
            })()
          )}
        </div>
      </section>

      {membershipQrOpen && membershipQr && (
        <div
          className="fixed inset-0 z-[180] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          aria-labelledby="profile-membership-qr-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setMembershipQrOpen(false);
          }}
        >
          <div className="w-full max-w-sm rounded-3xl border border-yellow-500/25 bg-[#11100c] p-6 text-center shadow-[0_30px_100px_rgba(0,0,0,0.7)]">
            <div className="flex items-start justify-between text-left">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-yellow-500/65">
                  Kiosk fallback access
                </p>
                <h3
                  id="profile-membership-qr-title"
                  className="mt-1 text-xl font-black text-yellow-300"
                >
                  Membership QR
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setMembershipQrOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-xl text-white/40 transition hover:bg-white/5 hover:text-white"
                aria-label="Close membership QR"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mx-auto mt-6 inline-flex rounded-2xl bg-white p-4 shadow-[0_12px_45px_rgba(234,179,8,0.18)]">
              <QRCodeSVG value={membershipQr} size={230} level="M" includeMargin />
            </div>
            <p className="mt-5 text-sm leading-6 text-white/55">
              Show this code to staff when the kiosk is unavailable. Staff will verify the
              vehicle and capture a check-in or check-out photo.
            </p>
            <p className="mt-2 text-xs font-semibold text-yellow-500/70">
              Valid until{" "}
              {profile.membership.expireAt
                ? new Date(profile.membership.expireAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "2-digit",
                    year: "numeric",
                  })
                : "your membership ends"}
            </p>
          </div>
        </div>
      )}

      {/* ════════════════════ TOAST ════════════════════ */}
      {toast && (
        <div
          className={`
            fixed bottom-6 left-1/2 -translate-x-1/2 z-[200]
            flex items-center gap-2.5 px-5 py-2.5 rounded-full
            text-sm font-semibold shadow-2xl backdrop-blur-md border
            transition-all duration-300
            ${toast.type === "saving"
              ? "bg-yellow-500/15 text-yellow-300 border-yellow-500/30"
              : toast.type === "success"
                ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                : "bg-red-500/15 text-red-300 border-red-500/30"
            }
          `}
        >
          {toast.type === "saving" && (
            <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0" />
          )}
          {toast.msg}
        </div>
      )}
    </div>
  );
}
