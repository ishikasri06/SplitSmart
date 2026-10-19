import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AuthGate from "./AuthGate.jsx";
import { createRoot } from "react-dom/client";
import { getProfileDisplayName, getUserInitials, useProfile } from "./useProfile.js";
import { useCloudExpenses } from "./useCloudExpenses.js";
import { useCloudSettlements } from "./useCloudSettlements.js";
import { useGroups } from "./useGroups.js";
import { useRecurringBills } from "./useRecurringBills.js";
import { usePreferences } from "./usePreferences.js";
import { useTheme } from "./useTheme.js";
import { changePassword } from "./authActions.js";
import {
  passwordStrength,
  passwordStrengthLabel,
  validatePasswordChange,
} from "./password.js";
import {
  DELETION_CONFIRMATION,
  clearLocalAppState,
  fetchDeletionStatus,
  isDeletionConfirmed,
  requestAccountDeletion,
} from "./accountDeletion.js";
import {
  REMINDER_LEAD_DAYS,
  SPLIT_METHOD_LABELS,
  SPLIT_METHODS,
} from "./preferences.js";
import { computeCloudDashboard } from "./cloudDashboard.js";
import {
  buildPaymentShares,
  bucketRecurringBills,
  dueLabel,
  FREQUENCY_LABELS,
  frequencyLabel,
  isBillDue,
  occurrencesForBill,
  RECURRING_FREQUENCIES,
  statusLabel,
  upcomingRecurringBills,
  validateRecurringConfig,
} from "./recurringBills.js";
import {
  acceptInvitation,
  createGroupInviteLink,
  createInvitation,
  getGroupInviteLink,
  getGroupMemberBalance,
  listInvitations,
  previewInvitation,
  removeGroupMember,
  revokeGroupInviteLink,
  revokeInvitation,
  setGroupMemberRole,
} from "./invitations.js";
import {
  buildInviteUrl,
  clearInviteParam,
  getInviteToken,
  isValidEmail,
  normalizeEmail,
} from "./inviteUtils.js";
import {
  clearGroupLinkToken,
  getGroupLinkToken,
  saveGroupLinkToken,
} from "./linkStore.js";
import {
  canChangeRoles,
  canManageInvitations,
  canRemoveMember,
} from "./permissions.js";
import { invitationStatusLabel, mapInvitationRow, mapMemberRow } from "./invitationMappers.js";
import {
  ArrowLeftRight, Bell, Check, ChevronDown, CircleDollarSign, ChartNoAxesCombined,
  Clipboard, House, Menu, Plus, ReceiptText, Search, Settings, Sparkles, UsersRound,
  X, Plane, Heart, BriefcaseBusiness, ShoppingBasket, Zap, Utensils, Trash2,
  Pencil, UserPlus, Link as LinkIcon, ArrowUpRight, Wallet, CircleHelp,
  LogOut, User, RotateCcw, CalendarClock, Repeat, Pause, Play,
  Sun, Moon, KeyRound, ShieldAlert, Eye, EyeOff
} from "lucide-react";
import { calculateBalances, money, simplifyDebts } from "./utils.js";
import { usePersonalExpenses } from "./usePersonalExpenses.js";
import { useNotifications } from "./useNotifications.js";
import { hasOutstandingBalance, outstandingBalanceMessage } from "./balanceGuard.js";
import {
  filterPersonalExpenses,
  PERSONAL_EXPENSE_CATEGORIES,
  summarizePersonalExpenses,
  validatePersonalExpense,
} from "./personalExpenses.js";
import { formatRelativeTime, notificationTone } from "./notifications.js";
import "./styles.css";

const currentDate = () => new Date().toISOString().slice(0, 10);
const nav = [
  { id: "Home", label: "Home", icon: House },
  { id: "Expenses", label: "Expenses", icon: ReceiptText },
  { id: "Personal", label: "Personal", icon: Wallet },
  { id: "Recurring Bills", label: "Recurring Bills", icon: CalendarClock },
  { id: "Balances", label: "Balances", icon: ArrowLeftRight },
  { id: "Groups", label: "Groups", icon: UsersRound },
  { id: "Insights", label: "Insights", icon: ChartNoAxesCombined },
];
const categories = ["Groceries", "Utilities", "Food & drink", "Transport", "Travel", "Household", "Rent", "Other"];
const categoryIcons = { Groceries: ShoppingBasket, Utilities: Zap, "Food & drink": Utensils, Transport: Plane, Travel: Plane, Household: House, Rent: House, Other: CircleDollarSign };
const groupTypes = ["Friends", "Trip", "Home", "Family", "Office", "Custom"];
const groupIcons = { Friends: Heart, Trip: Plane, Home: House, Family: Heart, Office: BriefcaseBusiness, Custom: UsersRound };
const displayDate = (date) => date ? new Date(`${date}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";
function Avatar({ member, small = false }) {
  const name = member?.name || "Unknown";
  const initials = name.split(/\s+/).slice(0,2).map((x) => x[0]).join("").toUpperCase();
  return <span className={`avatar ${member?.color || "lavender"} ${small ? "avatar-small" : ""}`} title={name}>{initials}</span>;
}
function Button({ children, variant = "secondary", ...props }) {
  return <button className={`btn btn-${variant}`} {...props}>{children}</button>;
}
function PageHeading({ eyebrow, title, subtitle, action }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{subtitle}</p></div>{action && <div className="heading-action">{action}</div>}</div>;
}
function Modal({ title, subtitle, onClose, children, wide = false }) {
  useEffect(() => { const handle = (e) => e.key === "Escape" && onClose(); window.addEventListener("keydown", handle); return () => window.removeEventListener("keydown", handle); }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><section className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}><div className="modal-header"><div><div className="eyebrow">SPLITSMART</div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-btn" onClick={onClose} aria-label="Close"><X size={19}/></button></div>{children}</section></div>;
}
function GroupSwitcher({ groups, activeGroup, activeGroupId, memberCount, onSelect }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const dropdownRef = useRef(null);

  const ActiveIcon = groupIcons[activeGroup?.type] || UsersRound;
  const typeLabel = activeGroup?.type || "Group";

  useEffect(() => {
    if (!open) return undefined;

    function handlePointer(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    }

    function handleKey(event) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      dropdownRef.current?.querySelector('[role="menuitem"]')?.focus();
    }
  }, [open]);

  function handleMenuKeyDown(event) {
    const items = Array.from(
      dropdownRef.current?.querySelectorAll('[role="menuitem"]') || []
    );
    if (!items.length) return;

    const current = items.indexOf(document.activeElement);

    if (event.key === "ArrowDown") {
      event.preventDefault();
      items[(current + 1 + items.length) % items.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      items[(current - 1 + items.length) % items.length]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      items[items.length - 1]?.focus();
    }
  }

  return (
    <div className="group-switcher-menu" ref={rootRef}>
      <button
        type="button"
        ref={buttonRef}
        className="group-switcher"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Selected group: ${activeGroup?.name || "none"}. Switch group`}
        title="Switch group"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="switcher-icon"><ActiveIcon size={18}/></span>
        <span className="switcher-copy">
          <b>{activeGroup?.name || "Select group"}</b>
          <small>{memberCount} {memberCount === 1 ? "member" : "members"} · {typeLabel}</small>
        </span>
        <ChevronDown size={16} className="switcher-arrow"/>
      </button>

      {open && (
        <div className="group-dropdown" role="menu" aria-label="Switch group" ref={dropdownRef} onKeyDown={handleMenuKeyDown}>
          <div className="group-dropdown-head">YOUR GROUPS</div>
          {groups.map((group) => {
            const Icon = groupIcons[group.type] || UsersRound;
            const isActive = group.id === activeGroupId;
            return (
              <button
                type="button"
                role="menuitem"
                key={group.id}
                className={`group-dropdown-item ${isActive ? "active" : ""}`}
                onClick={() => { setOpen(false); onSelect(group.id); }}
              >
                <span className="group-dropdown-icon"><Icon size={15}/></span>
                <span className="group-dropdown-copy"><b>{group.name}</b><small>{group.type || "Group"}</small></span>
                {isActive && <Check size={15} className="group-dropdown-check"/>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
function ProfileMenu({ authUser, profile, onOpenProfile, onLogout }) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState("");
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const dropdownRef = useRef(null);

  const displayName = getProfileDisplayName(authUser, profile);
  const initials = getUserInitials(authUser, profile);

  useEffect(() => {
    if (!open) return undefined;

    function handlePointer(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    }

    function handleKey(event) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      dropdownRef.current?.querySelector('[role="menuitem"]')?.focus();
    }
  }, [open]);

  function handleMenuKeyDown(event) {
    const items = Array.from(
      dropdownRef.current?.querySelectorAll('[role="menuitem"]') || []
    );
    if (!items.length) return;

    const current = items.indexOf(document.activeElement);

    if (event.key === "ArrowDown") {
      event.preventDefault();
      items[(current + 1 + items.length) % items.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      items[(current - 1 + items.length) % items.length]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      items[items.length - 1]?.focus();
    }
  }

  async function handleLogout() {
    setSigningOut(true);
    setError("");

    try {
      await onLogout();
    } catch (logoutError) {
      setError(logoutError?.message || "Could not log out. Please try again.");
      setSigningOut(false);
    }
  }

  return (
    <div className="profile-menu" ref={rootRef}>
      <button
        type="button"
        ref={buttonRef}
        className="avatar avatar-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        title={displayName}
        onClick={() => setOpen((value) => !value)}
      >
        {initials}
      </button>

      {open && (
        <div className="profile-dropdown" role="menu" aria-label="Account menu" ref={dropdownRef} onKeyDown={handleMenuKeyDown}>
          <div className="profile-dropdown-head">
            <b>{displayName}</b>
            <small title={authUser?.email}>{authUser?.email || "Signed in"}</small>
          </div>
          <div className="profile-dropdown-divider"/>
          <button type="button" role="menuitem" className="profile-dropdown-item" onClick={() => { setOpen(false); onOpenProfile(); }}>
            <User size={16}/> Profile
          </button>
          <div className="profile-dropdown-divider"/>
          <button type="button" role="menuitem" className="profile-dropdown-item danger" onClick={handleLogout} disabled={signingOut}>
            <LogOut size={16}/> {signingOut ? "Logging out..." : "Log out"}
          </button>
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}
function ProfileModal({ authUser, profile, displayName, onClose, onSave, notify }) {
  const [name, setName] = useState(profile?.full_name || authUser?.user_metadata?.full_name || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);

    try {
      await onSave(name);
      notify?.("Profile updated");
      onClose();
    } catch (saveError) {
      setError(saveError?.message || "Could not update your profile.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Your profile" subtitle="Manage how your name appears across SplitSmart." onClose={onClose}>
      <div className="profile-summary">
        <span className="avatar lavender">{getUserInitials(authUser, profile)}</span>
        <div className="profile-summary-copy">
          <b>{displayName}</b>
          <small>{authUser?.email || "Signed in"}</small>
        </div>
      </div>
      <form className="form-stack" onSubmit={handleSubmit}>
        <label>
          Display name
          <input autoFocus maxLength="80" placeholder="Your name" value={name} onChange={(event) => setName(event.target.value)}/>
          <small>This name is shown in your groups and invitations.</small>
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>{busy ? "Saving..." : "Save changes"}</Button>
        </div>
      </form>
    </Modal>
  );
}
function ThemeToggle({ resolved, onChange }) {
  const isDark = resolved === "dark";
  const label = isDark ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button
      type="button"
      className="icon-btn theme-toggle"
      onClick={() => onChange(isDark ? "light" : "dark")}
      aria-label={label}
      title={label}
    >
      {isDark ? <Sun size={18}/> : <Moon size={18}/>}
    </button>
  );
}
function App({ authUser, onLogout }) {
  const {
    profile,
    loading: profileLoading,
    repairing: profileRepairing,
    error: profileError,
    refresh: refreshProfile,
    updateName,
  } = useProfile(authUser);

  const [page, setPage] = useState("Home");
  const [activeGroupId, setActiveGroupId] = useState("");
  const [groupMembers, setGroupMembers] = useState([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState("");
  const [membersRefreshToken, setMembersRefreshToken] = useState(0);
  const [modal, setModal] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [toast, setToast] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [editExpenseId, setEditExpenseId] = useState(null);
  const [inviteToken, setInviteToken] = useState(() =>
    getInviteToken(typeof window !== "undefined" ? window.location : null)
  );

  const cloudGroups = useGroups(authUser, true);
  const cloudExpenseData = useCloudExpenses(authUser, activeGroupId, Boolean(activeGroupId));
  const cloudSettlementData = useCloudSettlements(authUser, activeGroupId, Boolean(activeGroupId));
  const cloudRecurring = useRecurringBills(authUser, activeGroupId, Boolean(activeGroupId));
  const preferencesData = usePreferences(authUser);
  const personalData = usePersonalExpenses(authUser, true);
  const notificationsData = useNotifications(authUser);
  const theme = useTheme(authUser, preferencesData);
  const defaultSplitMethod = preferencesData.preferences.defaultSplitMethod;

  const groups = cloudGroups.groups;
  const groupsLoading = cloudGroups.loading;
  const groupsError = cloudGroups.error;

  // Select the first group automatically, and keep the selection valid.
  useEffect(() => {
    if (groupsLoading || !groups.length) return;
    if (!activeGroupId || !groups.some((group) => group.id === activeGroupId)) {
      setActiveGroupId(groups[0].id);
    }
  }, [groupsLoading, groups, activeGroupId]);

  // The profile row exists only once useProfile has loaded it (and rebuilt it
  // if it was missing). public.list_group_members() joins public.profiles with
  // an INNER JOIN, so loading members before the row is there would give us a
  // member list that is missing the signed-in user (wrong member counts, split
  // participants and balance labels). Wait for it, then load once, fully.
  const profileReady = Boolean(profile);
  const profilePending = Boolean(authUser) && (profileLoading || profileRepairing);
  // Not ready and not still loading: the read failed or the row is missing and
  // could not be rebuilt. Either way group data cannot be trusted yet.
  const profileBlocked = Boolean(authUser) && !profilePending && !profileReady;

  useEffect(() => {
    let cancelled = false;

    async function loadMembers() {
      if (!activeGroupId || !profileReady) {
        setGroupMembers([]);
        setMembersError("");
        setMembersLoading(false);
        return;
      }

      setMembersLoading(true);
      setMembersError("");

      try {
        const rows = (await cloudGroups.loadMembers(activeGroupId)) || [];

        if (!cancelled) {
          setGroupMembers(
            rows.map((member) => ({
              id: member.user_id,
              name: member.full_name || "Member",
              role: member.role,
              color: "lavender",
            }))
          );
        }
      } catch (error) {
        if (!cancelled) {
          setGroupMembers([]);
          setMembersError(error.message || "Could not load group members.");
        }
      } finally {
        if (!cancelled) setMembersLoading(false);
      }
    }

    void loadMembers();

    return () => {
      cancelled = true;
    };
  }, [authUser?.id, activeGroupId, profileReady, membersRefreshToken, cloudGroups.loadMembers]);
  const membersById = useMemo(
    () => Object.fromEntries(groupMembers.map((member) => [member.id, member])),
    [groupMembers]
  );

  const activeGroup = groups.find((group) => group.id === activeGroupId) || null;
  const groupExpenses = cloudExpenseData.expenses;
  const groupSettlements = cloudSettlementData.settlements;
  const recurringBills = cloudRecurring.bills;
  const balances = useMemo(() => calculateBalances(groupExpenses, groupSettlements), [groupExpenses, groupSettlements]);
  const transfers = useMemo(() => simplifyDebts(balances), [balances]);
  const total = groupExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const dashboard = useMemo(
    () => computeCloudDashboard({
      expenses: groupExpenses,
      settlements: groupSettlements,
      currentUserId: authUser?.id,
    }),
    [groupExpenses, groupSettlements, authUser?.id]
  );

  const userName = getProfileDisplayName(authUser, profile);
  const signedInUser = { name: userName, color: "lavender" };
  const signedInLabel = profileBlocked
    ? "Profile needs attention"
    : profilePending
      ? "Setting up your account..."
      : authUser?.email || "Signed in";

  const filteredExpenses = useMemo(
    () => groupExpenses
      .filter((expense) => (
        `${expense.title} ${expense.category} ${membersById[expense.paidById]?.name || ""}`
          .toLowerCase()
          .includes(search.toLowerCase())
        && (categoryFilter === "All" || expense.category === categoryFilter)
      ))
      .sort((a, b) => b.createdAt - a.createdAt),
    [groupExpenses, search, categoryFilter, membersById]
  );

  const noGroups = !groupsLoading && !groupsError && groups.length === 0;

  const notify = (message) => { setToast(message); window.clearTimeout(notify.timer); notify.timer = window.setTimeout(() => setToast(""), 2800); };
  const selectGroup = (id) => { setActiveGroupId(id); setSearch(""); setCategoryFilter("All"); };
  const refreshMembers = () => setMembersRefreshToken((value) => value + 1);

  // Runs after the account has been permanently deleted server-side: drop any
  // cached local app state, then end the (now defunct) session so AuthGate
  // returns to the signed-out screen.
  const handleAccountDeleted = async () => {
    clearLocalAppState();
    try {
      await onLogout();
    } catch {
      // The auth user is already gone; a failed sign-out is harmless because
      // the stored session can no longer be used.
    }
  };

  const openAddExpense = () => {
    if (!activeGroupId) { notify("Create or select a group first."); return; }
    if (!groupMembers.length) { notify("This group has no members to split with yet."); return; }
    setEditExpenseId(null);
    setModal({ type: "expense" });
  };

  const saveGroup = async (form) => {
    try {
      const group = await cloudGroups.createGroup(form);
      setActiveGroupId(group.id);
      setModal(null);
      setPage("Groups");
      notify(`Created ${group.name}`);
    } catch (error) {
      notify(error.message || "Could not create group");
    }
  };

  const saveExpense = async (form) => {
    try {
      await cloudExpenseData.createExpense(form);
      setModal(null);
      setEditExpenseId(null);
      notify("Expense added");
    } catch (error) {
      notify(error.message || "Could not save expense");
    }
  };

  const updateExpense = async (expenseId, form) => {
    try {
      await cloudExpenseData.updateExpense(expenseId, form);
      setModal(null);
      setEditExpenseId(null);
      notify("Expense updated");
    } catch (error) {
      notify(error.message || "Could not update expense");
    }
  };

  const deleteExpense = async (id) => {
    if (!window.confirm("Delete this expense? Balances will be recalculated.")) return;

    try {
      await cloudExpenseData.deleteExpense(id);
      notify("Expense deleted and balances recalculated");
    } catch (error) {
      notify(error.message || "Could not delete expense");
    }
  };

  const savePersonalExpense = async (form, expenseId) => {
    try {
      if (expenseId) await personalData.updateExpense(expenseId, form);
      else await personalData.createExpense(form);
      setModal(null);
      setEditExpenseId(null);
      notify(expenseId ? "Personal expense updated" : "Personal expense added");
    } catch (error) {
      notify(error.message || "Could not save personal expense");
    }
  };

  const deletePersonalExpense = async (id) => {
    if (!window.confirm("Delete this personal expense?")) return;

    try {
      await personalData.deleteExpense(id);
      notify("Personal expense deleted");
    } catch (error) {
      notify(error.message || "Could not delete personal expense");
    }
  };

  const recordSettlement = async (transfer, amount) => {
    try {
      await cloudSettlementData.recordSettlement({ fromId: transfer.fromId, toId: transfer.toId, amount });
      setModal(null);
      notify("Settlement recorded");
    } catch (error) {
      notify(error.message || "Could not record settlement");
    }
  };

  const saveRecurringBill = async (form, billId) => {
    try {
      if (billId) await cloudRecurring.updateBill(billId, form);
      else await cloudRecurring.createBill(form);
      setModal(null);
      setEditExpenseId(null);
      notify(billId ? "Recurring bill updated" : "Recurring bill created");
    } catch (error) {
      notify(error.message || "Could not save recurring bill");
    }
  };

  const recordRecurringPayment = async (bill) => {
    try {
      const shares = buildPaymentShares(bill);
      await cloudRecurring.recordPayment({ billId: bill.id, occurrenceDate: bill.nextDueDate, shares });
      cloudExpenseData.refresh();
      notify("Recurring payment recorded");
    } catch (error) {
      notify(error.message || "Could not record payment");
    }
  };

  const changeRecurringStatus = async (bill, status) => {
    try {
      await cloudRecurring.setStatus(bill.id, status);
      notify(
        status === "paused"
          ? "Recurring bill paused"
          : status === "cancelled"
            ? "Recurring bill cancelled"
            : "Recurring bill resumed"
      );
    } catch (error) {
      notify(error.message || "Could not update recurring bill");
    }
  };

  const renderGroupPage = (content) => {
    // Profile rows feed public.list_group_members(), so group data (members,
    // split participants, expense payer names, balances) is only trustworthy
    // once the profile is present. Show a repair state instead of silently
    // rendering an empty or half-populated ledger.
    if (profilePending) {
      return <div className="page-wrap"><Empty
        title={profileRepairing ? "Restoring your profile" : "Setting up your account"}
        detail={profileRepairing
          ? "Your profile row was missing, so we are restoring it before loading group data."
          : "Loading your profile and group data."}/></div>;
    }

    if (profileBlocked) {
      return <div className="page-wrap"><section className="panel"><Empty
        title="Your profile could not be loaded"
        detail={profileError || "Group data is hidden until your profile row exists again."}/><div className="panel-bottom"><Button onClick={refreshProfile}>Try again</Button></div></section></div>;
    }

    if (groupsLoading) {
      return <div className="page-wrap"><Empty title="Loading your groups" detail="Fetching groups from your account."/></div>;
    }

    if (groupsError) {
      return <div className="page-wrap"><section className="panel"><Empty title="Could not load groups" detail={groupsError}/><div className="panel-bottom"><Button onClick={cloudGroups.refresh}>Try again</Button></div></section></div>;
    }

    if (noGroups) {
      return <div className="page-wrap"><Empty title="No groups yet" detail="Create your first group to start tracking shared expenses."/></div>;
    }

    if (!activeGroup) {
      return <div className="page-wrap"><Empty title="Loading group" detail="Preparing your group data."/></div>;
    }

    return content;
  };

  if (inviteToken) {
    return (
      <InvitationScreen
        token={inviteToken}
        authUser={authUser}
        onClose={() => {
          clearInviteParam();
          setInviteToken("");
        }}
        onJoined={() => {
          clearInviteParam();
          setInviteToken("");
          setPage("Groups");
          cloudGroups.refresh();
        }}
      />
    );
  }

  const groupMemberList = groupMembers;
  const expenseGroup = activeGroup ? { ...activeGroup, memberIds: groupMembers.map((member) => member.id) } : null;

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? "mobile-open" : ""}`}>
      <div className="brand"><div className="brand-mark"><ArrowLeftRight size={21}/></div><span>split<span className="brand-accent">smart</span></span></div>
      {activeGroup && <GroupSwitcher groups={groups} activeGroup={activeGroup} activeGroupId={activeGroupId} memberCount={groupMemberList.length} onSelect={(id) => { selectGroup(id); setMobileNav(false); }}/>}
      <nav className="main-nav">{nav.map((item) => <button key={item.id} onClick={() => { setPage(item.id); setMobileNav(false); }} className={`nav-item ${page === item.id ? "active" : ""}`}><item.icon size={18}/><span>{item.label}</span></button>)}</nav>
      <div className="sidebar-spacer"/>
      <button className={`nav-item settings-link ${page === "Settings" ? "active" : ""}`} onClick={() => { setPage("Settings"); setMobileNav(false); }}><Settings size={18}/><span>Settings</span></button>
      <div className="profile-row"><Avatar member={signedInUser}/><div className="profile-copy"><b>{signedInUser.name}</b><small title={profileError ? "Profile details could not be loaded; using account details instead." : undefined}>{signedInLabel}</small></div></div>
    </aside>
    {mobileNav && <button className="mobile-scrim" aria-label="Close menu" onClick={() => setMobileNav(false)}/>}
    <main className="main-content">
      <header className="topbar"><button className="mobile-menu icon-btn" onClick={() => setMobileNav(true)} aria-label="Open menu"><Menu size={20}/></button><div className="breadcrumb">{activeGroup?.name || "SplitSmart"} <span>/</span> <b>{page}</b></div><div className="topbar-actions"><ThemeToggle resolved={theme.resolved} onChange={theme.setMode}/><NotificationBell notifications={notificationsData.notifications} unread={notificationsData.unreadCount} loading={notificationsData.loading} error={notificationsData.error} onMarkRead={notificationsData.markRead} onMarkAllRead={notificationsData.markAllRead} onRefresh={notificationsData.refresh} onNavigate={setPage}/><span className="top-divider"/><ProfileMenu authUser={authUser} profile={profile} onOpenProfile={() => setProfileOpen(true)} onLogout={onLogout}/></div>      </header>
      {page === "Home" && renderGroupPage(
        <div className="page-wrap">
          <Dashboard
            group={activeGroup}
            members={groupMemberList}
            expenses={groupExpenses}
            balances={balances}
            total={total}
            membersById={membersById}
            userName={userName}
            currentUserId={authUser?.id}
            bills={recurringBills}
            loading={cloudExpenseData.loading || cloudSettlementData.loading || membersLoading}
            error={cloudExpenseData.error || cloudSettlementData.error || membersError}
            onAdd={openAddExpense}
            onNavigate={setPage}
            onRecordBill={recordRecurringPayment}
          />
        </div>
      )}
      {page === "Expenses" && renderGroupPage(
        <ExpensesPage
          expenses={filteredExpenses}
          membersById={membersById}
          search={search}
          setSearch={setSearch}
          categoryFilter={categoryFilter}
          setCategoryFilter={setCategoryFilter}
          onAdd={openAddExpense}
          onEdit={(expense) => {
            setEditExpenseId(expense.id);
            setModal({ type: "expense", expense });
          }}
          onDelete={deleteExpense}
        />
      )}
      {page === "Personal" && (
        <PersonalExpensesPage
          expenses={personalData.expenses}
          loading={personalData.loading}
          error={personalData.error}
          onAdd={() => { setEditExpenseId(null); setModal({ type: "personal-expense" }); }}
          onEdit={(expense) => { setEditExpenseId(expense.id); setModal({ type: "personal-expense", expense }); }}
          onDelete={deletePersonalExpense}
          onRetry={personalData.refresh}
        />
      )}
      {page === "Recurring Bills" && renderGroupPage(
        <RecurringBillsPage
          bills={recurringBills}
          occurrences={cloudRecurring.occurrences}
          members={groupMemberList}
          membersById={membersById}
          currentUserId={authUser?.id}
          loading={cloudRecurring.loading || membersLoading}
          error={cloudRecurring.error || membersError}
          onCreate={() => { setEditExpenseId(null); setModal({ type: "expense", recurringMode: true }); }}
          onEdit={(bill) => { setEditExpenseId(null); setModal({ type: "expense", bill }); }}
          onRecord={recordRecurringPayment}
          onStatus={changeRecurringStatus}
        />
      )}
      {page === "Balances" && renderGroupPage(
        <BalancesPage
          group={activeGroup}
          members={groupMemberList}
          membersById={membersById}
          balances={balances}
          transfers={transfers}
          settlements={groupSettlements}
          currentUserId={authUser?.id}
          onSettle={(transfer) => { setModal({ type: "settlement", transfer }); }}
        />
      )}
      {page === "Groups" && (
        <CloudGroupsPage
          groups={groups}
          loading={groupsLoading}
          error={groupsError}
          onCreate={() => setModal({ type: "cloud-create-group" })}
          onMembers={(group) => setModal({ type: "cloud-members", group })}
          onRefresh={cloudGroups.refresh}
        />
      )}
      {page === "Settings" && (
        <SettingsPage
          authUser={authUser}
          profile={profile}
          loading={preferencesData.loading}
          error={preferencesData.error}
          saving={preferencesData.saving}
          preferences={preferencesData.preferences}
          onSave={preferencesData.save}
          onOpenProfile={() => setProfileOpen(true)}
          onAccountDeleted={handleAccountDeleted}
        />
      )}
      {page === "Insights" && renderGroupPage(
        <InsightsPage expenses={groupExpenses} total={total} members={groupMemberList} membersById={membersById}/>
      )}
      <footer className="footer">
        <div className="footer-brand">
          <span className="brand-mark footer-mark"><ArrowLeftRight size={18}/></span>
          <div className="footer-brand-text">
            <b>split<span className="brand-accent">smart</span></b>
            <small>Smart expense sharing, made simple. Track, split, and settle with ease.</small>
          </div>
        </div>
        <span className="footer-meta">SplitSmart · Cloud</span>
      </footer>
    </main>
    {modal?.type === "cloud-create-group" && <CloudCreateGroupModal onClose={() => setModal(null)} onSave={saveGroup}/>}
    {modal?.type === "cloud-members" && <CloudMembersModal group={modal.group} authUserId={authUser?.id} loadMembers={cloudGroups.loadMembers} onClose={() => setModal(null)} onChanged={() => { cloudGroups.refresh(); refreshMembers(); }} notify={notify}/>}
    {profileOpen && <ProfileModal authUser={authUser} profile={profile} displayName={userName} onClose={() => setProfileOpen(false)} onSave={updateName} notify={notify}/>}
    {modal?.type === "expense" && expenseGroup && <ExpenseModal key={modal.expense?.id || modal.bill?.id || (modal.recurringMode ? "new-recurring" : "new")} group={expenseGroup} members={groupMemberList} currentUserId={authUser?.id} expense={modal.expense || groupExpenses.find((e) => e.id === editExpenseId)} bill={modal.bill} recurringMode={modal.recurringMode} defaultSplitMethod={defaultSplitMethod} onSaveRecurring={(form) => saveRecurringBill(form, modal.bill?.id)} onClose={() => { setModal(null); setEditExpenseId(null); }} onSave={(form) => (modal.expense || editExpenseId ? updateExpense(modal.expense?.id || editExpenseId, form) : saveExpense(form))}/>}
    {modal?.type === "settlement" && <SettlementModal transfer={modal.transfer} membersById={membersById} currentUserId={authUser?.id} onClose={() => setModal(null)} onSave={recordSettlement}/>}
    {modal?.type === "personal-expense" && <PersonalExpenseModal expense={modal.expense || personalData.expenses.find((expense) => expense.id === editExpenseId)} onClose={() => { setModal(null); setEditExpenseId(null); }} onSave={(form) => savePersonalExpense(form, modal.expense?.id || editExpenseId)}/>}
    {modal?.type === "invite-picker" && <Modal title="Invite members" subtitle="Choose a group to invite people to." onClose={() => setModal(null)}>{groups.length ? groups.map((group) => <button className="picker-row" key={group.id} onClick={() => setModal({ type: "cloud-members", group })}><span><b>{group.name}</b><small>{group.type || "Group"} · members</small></span><LinkIcon size={17}/></button>) : <Empty title="No groups yet" detail="Create a group before inviting members."/>}</Modal>}
    {toast && <div className="toast"><Check size={17}/>{toast}</div>}
  </div>;
}
function Dashboard({ group, members, expenses, balances, total, membersById, userName, currentUserId, onAdd, onNavigate, bills = [], onRecordBill, loading = false, error = "", showBalancesLink = true }) {
  if (loading) {
    return <div className="page-wrap"><Empty title="Loading dashboard" detail="Fetching the latest group data..."/></div>;
  }
  if (error) {
    return <div className="page-wrap"><Empty title="Could not load dashboard" detail={error}/></div>;
  }
  const myNet = balances?.[currentUserId] ?? 0;
  const recent = [...expenses].sort((a,b) => b.createdAt - a.createdAt).slice(0,4);
  const upcomingBills = upcomingRecurringBills(bills);
  return <div className="page-wrap"><PageHeading eyebrow={`YOUR ${group?.type?.toUpperCase() || "GROUP"} SPACE`} title={`Hey, ${(userName || "there").split(" ")[0] || "there"} 👋`} subtitle="Here's the latest with your shared spending." action={<Button variant="primary" onClick={onAdd}><Plus size={17}/> Add expense</Button>}/>
    <section className="hero-card"><div className="hero-content"><span className="hero-kicker"><Sparkles size={14}/> YOUR GROUP SNAPSHOT</span><h2>{money(total)}</h2><p>Total expenses recorded in <b>{group?.name}</b></p><div className="hero-bottom"><span><UsersRound size={15}/> {members.length} members</span><span><ReceiptText size={15}/> {expenses.length} expenses</span></div></div><div className="hero-art"><div className="hero-orbit orbit-one"/><div className="hero-orbit orbit-two"/><div className="hero-coin"><ArrowLeftRight size={35}/></div><span className="floating-chip chip-one">₹</span><span className="floating-chip chip-two"><Check size={16}/></span></div></section>
    <section className="stats-grid"><StatCard icon={Wallet} label="Your net balance" value={`${myNet >= 0 ? "+" : "−"}${money(Math.abs(myNet))}`} detail={myNet > 0.009 ? "You're owed overall" : myNet < -0.009 ? "You owe overall" : "You're all settled"} color={myNet >= 0 ? "mint" : "peach"}/><StatCard icon={ReceiptText} label="Average expense" value={money(expenses.length ? total / expenses.length : 0)} detail="Per transaction" color="lavender"/><StatCard icon={UsersRound} label="Group members" value={members.length} detail="Sharing expenses" color="blue"/></section>
    {upcomingBills.length > 0 && <section className="panel upcoming-bills"><div className="panel-heading"><div><h2>Upcoming bills</h2><p>Recurring costs due soon in this group</p></div><button className="text-link" onClick={() => onNavigate("Recurring Bills")}>View all <ArrowUpRight size={15}/></button></div>{upcomingBills.slice(0, 4).map((bill) => <div className="bill-row" key={bill.id}><div className={`expense-icon ${isBillDue(bill) ? "peach" : "blue"}`}><CalendarClock size={18}/></div><div className="bill-row-main"><b>{bill.title}</b><span>{frequencyLabel(bill.frequency)} · {displayDate(bill.nextDueDate)}</span></div><div className="bill-row-meta"><b>{money(bill.amount)}</b><span className={isBillDue(bill) ? "due-pill" : "muted-text"}>{dueLabel(bill)}</span></div>{onRecordBill && <Button variant="primary" onClick={() => onRecordBill(bill)}>Record</Button>}</div>)}</section>}
    <div className="content-grid dashboard-grid"><section className="panel"><div className="panel-heading"><div><h2>Recent expenses</h2><p>The latest shared costs in this group</p></div><button className="text-link" onClick={() => onNavigate("Expenses")}>View all <ArrowUpRight size={15}/></button></div>{recent.length ? recent.map((e) => <ExpenseRow key={e.id} expense={e} membersById={membersById}/>) : <Empty title="No expenses yet" detail="Add your first expense to get started."/>}<div className="panel-bottom"><Button onClick={onAdd}><Plus size={15}/> Add expense</Button></div></section>
      <section className="panel"><div className="panel-heading"><div><h2>Balances at a glance</h2><p>Based on this group's expense history</p></div>{showBalancesLink && <button className="text-link" onClick={() => onNavigate("Balances")}>Details <ArrowUpRight size={15}/></button>}</div>{members.slice(0,4).map((m) => <div className="mini-balance" key={m.id}><Avatar member={m} small/><span>{m.id === currentUserId ? "You" : m.name}</span><b className={(balances[m.id] || 0) > 0.009 ? "positive" : (balances[m.id] || 0) < -0.009 ? "negative" : "neutral"}>{(balances[m.id] || 0) > 0.009 ? "+" : (balances[m.id] || 0) < -0.009 ? "−" : ""}{money(Math.abs(balances[m.id] || 0))}</b></div>)}{!members.length && <Empty title="Add members" detail="Group members appear here."/>}<div className="info-tip"><Sparkles size={16}/><span>Balances are calculated from expenses and recorded settlements.</span></div></section></div>
  </div>;
}
function StatCard({ icon: Icon, label, value, detail, color }) { return <div className="stat-card"><div className="stat-top"><span className={`stat-icon ${color}`}><Icon size={18}/></span><span className="stat-label">{label}</span></div><div className="stat-value">{value}</div><p>{detail}</p></div>; }

function ExpenseRow({ expense, membersById, onEdit , onDelete }) {
  const Icon = categoryIcons[expense.category] || CircleDollarSign;

  return (
    <div className="expense-row">
      <div
        className={`expense-icon ${
          expense.category === "Utilities"
            ? "yellow"
            : expense.category === "Food & drink"
              ? "pink"
              : "mint"
        }`}
      >
        <Icon size={18} />
      </div>

      <div className="expense-main">
        <b>{expense.title}</b>
        <span>
          {membersById[expense.paidById]?.name || "Unknown"} paid ·{" "}
          {displayDate(expense.date)}
        </span>
      </div>

      <div className="expense-meta">
        <b>{money(expense.amount)}</b>
        <span>{expense.participantIds.length} participants</span>
      </div>

      {onEdit && (
        <button
          type="button"
          className="secondary-button"
          onClick={() => onEdit(expense)}
        >
          Edit
        </button>
      )}

      
{onDelete && (
  <button
    type="button"
    className="secondary-button"
    onClick={() => onDelete(expense)}
  >
    Delete
  </button>
)}

    </div>
  );
}
function Empty({ title, detail }) { return <div className="empty-state"><ReceiptText size={26}/><b>{title}</b><span>{detail}</span></div>; }
function ExpensesPage({ expenses, membersById, search, setSearch, categoryFilter, setCategoryFilter, onAdd, onEdit, onDelete }) {
  return <div className="page-wrap"><PageHeading eyebrow="THE SHARED LEDGER" title="Expenses" subtitle="Every shared cost, clearly accounted for." action={<Button variant="primary" onClick={onAdd}><Plus size={17}/> Add expense</Button>}/><section className="panel"><div className="toolbar"><div className="search-box"><Search size={17}/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search expenses..."/></div><select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Filter by category"><option>All</option>{categories.map((c) => <option key={c}>{c}</option>)}</select></div><div className="table-head"><span>EXPENSE</span><span>PAID BY</span><span>DATE</span><span>AMOUNT</span><span>ACTIONS</span></div>{expenses.length ? expenses.map((e) => <div className="expense-table-row" key={e.id}><div className="table-expense"><div className="expense-icon lavender"><ReceiptText size={17}/></div><div><b>{e.title}</b><small>{e.category} · {e.participantIds.length} participants</small></div></div><span className="paid-by"><Avatar member={membersById[e.paidById]} small/>{membersById[e.paidById]?.name || "Unknown"}</span><span className="table-date">{displayDate(e.date)}</span><b className="table-amount">{money(e.amount)}</b><div className="table-actions"><button className="icon-btn" title="Edit expense" onClick={() => onEdit(e)}><Pencil size={15}/></button><button className="icon-btn danger" title="Delete expense" onClick={() => onDelete(e.id)}><Trash2 size={15}/></button></div></div>) : <Empty title="No expenses found" detail="Try another search or add a new expense."/>}</section></div>;
}
function CloudGroupsPage({ groups, loading, error, onCreate, onMembers, onRefresh }) {
  return <div className="page-wrap"><PageHeading eyebrow="YOUR WORKSPACE" title="Groups" subtitle="Groups stored securely in your SplitSmart account." action={<Button variant="primary" onClick={onCreate}><Plus size={17}/> Create group</Button>}/>{loading ? <Empty title="Loading groups" detail="Fetching groups available to your signed-in account."/> : error ? <section className="panel"><Empty title="Could not load groups" detail={error}/><div className="panel-bottom"><Button onClick={onRefresh}>Try again</Button></div></section> : <div className="group-grid">{groups.map((group) => { const Icon = groupIcons[group.type] || UsersRound; return <article className="group-card" key={group.id}><div className="group-card-top"><span className={`group-icon ${group.type === "Trip" ? "mint" : group.type === "Home" ? "lavender" : group.type === "Office" ? "blue" : "peach"}`}><Icon size={22}/></span><span className="group-type">{group.type}</span></div><h2>{group.name}</h2><p>{group.description || "Shared expenses and balances"}</p><div className="group-stats"><span><UsersRound size={15}/>Group membership</span></div><div className="group-card-actions"><Button onClick={() => onMembers(group)}><UsersRound size={15}/> Manage members</Button></div></article>; })}{!groups.length && <div className="group-card"><Empty title="No groups yet" detail="Create your first group to get started."/></div>}</div>}</div>;
}
function CloudCreateGroupModal({ onClose, onSave }) {
  const [form, setForm] = useState({ name: "", type: "Friends", description: "" });
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  return <Modal title="Create a cloud group" subtitle="This group is stored in your authenticated SplitSmart account." onClose={onClose}><form className="form-stack" onSubmit={(event) => { event.preventDefault(); if (form.name.trim()) onSave(form); }}><label>Group name<input required autoFocus maxLength="60" placeholder="e.g. Goa Trip, Flat 302" value={form.name} onChange={(event) => update("name", event.target.value)}/></label><label>Group type<select value={form.type} onChange={(event) => update("type", event.target.value)}>{groupTypes.map((type) => <option key={type}>{type}</option>)}</select></label><label>Description <span className="muted-text">(optional)</span><input maxLength="120" placeholder="What's this group for?" value={form.description} onChange={(event) => update("description", event.target.value)}/></label><div className="notice"><CircleHelp size={16}/> You will be added as the owner automatically. Manage members and invite links from the group's Members dialog.</div><div className="form-actions"><Button type="button" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary"><Plus size={16}/> Create cloud group</Button></div></form></Modal>;
}
function CloudMembersModal({ group, authUserId, loadMembers, onClose, onChanged, notify }) {
  const [members, setMembers] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [formError, setFormError] = useState("");
  const [createdInvite, setCreatedInvite] = useState(null);
  const [link, setLink] = useState(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState("");
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveError, setLeaveError] = useState("");

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const rows = (await loadMembers(group.id)) || [];
      setMembers(rows.map(mapMemberRow));
    } catch (loadError) {
      setError(loadError.message || "Could not load group members.");
    } finally {
      setLoading(false);
    }
  }, [group.id, loadMembers]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const selfMember = members.find((member) => member.id === authUserId);
  const myRole = selfMember?.role || "member";
  const ownerCount = members.filter((member) => member.role === "owner").length;
  const isLastOwner = selfMember?.role === "owner" && ownerCount <= 1;
  const canInvite = canManageInvitations(myRole);
  const canRole = canChangeRoles(myRole);

  const loadInviteList = useCallback(async () => {
    if (!canManageInvitations(myRole)) {
      setInvitations([]);
      return;
    }

    try {
      setInvitations((await listInvitations(group.id)).map(mapInvitationRow));
    } catch {
      setInvitations([]);
    }
  }, [group.id, myRole]);

  useEffect(() => {
    void loadInviteList();
  }, [loadInviteList]);

  const loadLink = useCallback(async () => {
    if (!canManageInvitations(myRole)) {
      setLink(null);
      setLinkUrl("");
      return;
    }

    try {
      const info = await getGroupInviteLink(group.id);
      setLink(info);

      const cached = getGroupLinkToken(group.id);

      if (info && info.status === "active" && cached) {
        setLinkUrl(buildInviteUrl(window.location.origin, cached));
      } else {
        setLinkUrl("");
      }
    } catch {
      setLink(null);
      setLinkUrl("");
    }
  }, [group.id, myRole]);

  useEffect(() => {
    void loadLink();
  }, [loadLink]);

  async function handleCreateLink() {
    setLinkError("");
    setLinkBusy(true);

    try {
      const result = await createGroupInviteLink(group.id);

      if (!result) throw new Error("Could not create the invite link.");

      if (result.token) {
        saveGroupLinkToken(group.id, result.token);
        setLinkUrl(buildInviteUrl(window.location.origin, result.token));
        notify?.(result.created ? "Invite link created" : "Invite link ready");
      } else {
        notify?.("An active invite link already exists.");
      }

      await loadLink();
    } catch (linkCreateError) {
      setLinkError(linkCreateError.message || "Could not create the invite link.");
    } finally {
      setLinkBusy(false);
    }
  }

  async function handleRevokeLink() {
    if (!window.confirm("Revoke the active invite link? Anyone holding this link will no longer be able to join.")) return;

    setLinkBusy(true);

    try {
      await revokeGroupInviteLink(group.id);
      clearGroupLinkToken(group.id);
      setLinkUrl("");
      await loadLink();
      notify?.("Invite link revoked");
    } catch (linkRevokeError) {
      notify?.(linkRevokeError.message || "Could not revoke the invite link");
    } finally {
      setLinkBusy(false);
    }
  }

  async function handleInvite(event) {
    event.preventDefault();
    setFormError("");
    setCreatedInvite(null);

    const value = normalizeEmail(email);

    if (!isValidEmail(value)) {
      setFormError("Enter a valid email address.");
      return;
    }

    setBusy(true);

    try {
      const result = await createInvitation(group.id, value);

      if (!result) throw new Error("Could not create the invitation.");

      setCreatedInvite({
        email: value,
        url: buildInviteUrl(window.location.origin, result.token),
      });
      setEmail("");
      await loadInviteList();
      notify?.(`Invitation ready for ${value}`);
    } catch (inviteError) {
      setFormError(inviteError.message || "Could not create the invitation.");
    } finally {
      setBusy(false);
    }
  }

  async function copyInvite(url) {
    try {
      await navigator.clipboard?.writeText(url);
      notify?.("Invite link copied");
    } catch {
      notify?.(url);
    }
  }

  async function handleRevoke(invitation) {
    if (!window.confirm(`Revoke the invitation for ${invitation.email}?`)) return;

    setBusy(true);

    try {
      await revokeInvitation(invitation.id);
      await loadInviteList();
      notify?.("Invitation revoked");
    } catch (revokeError) {
      notify?.(revokeError.message || "Could not revoke the invitation");
    } finally {
      setBusy(false);
    }
  }

  function openLeave() {
    setLeaveError("");
    setLeaveOpen(true);
  }

  async function confirmLeave() {
    if (isLastOwner) {
      setLeaveError("Transfer ownership to another member before leaving. A group must always keep an owner.");
      return;
    }

    setBusy(true);
    setLeaveError("");

    try {
      const net = await getGroupMemberBalance(group.id, authUserId);

      if (hasOutstandingBalance(net)) {
        setLeaveError(outstandingBalanceMessage(net, { self: true, name: selfMember?.name }));
        return;
      }

      await removeGroupMember(group.id, authUserId);

      notify?.("You left the group");
      setLeaveOpen(false);
      await onChanged?.();
      onClose?.();
    } catch (error) {
      setLeaveError(error.message || "Could not leave the group.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(member) {
    setBusy(true);

    try {
      const net = await getGroupMemberBalance(group.id, member.id);

      if (hasOutstandingBalance(net)) {
        notify?.(outstandingBalanceMessage(net, { self: false, name: member.name }));
        return;
      }

      if (!window.confirm(`Remove ${member.name} from this group? They will lose access, but the group, its expenses and its history stay with the remaining members.`)) return;

      await removeGroupMember(group.id, member.id);
      await loadAll();
      await loadInviteList();
      onChanged?.();
      notify?.("Member removed");
    } catch (removeError) {
      notify?.(removeError.message || "Could not remove the member");
    } finally {
      setBusy(false);
    }
  }

  async function handleRole(member, role) {
    if (role === member.role) return;

    setBusy(true);

    try {
      await setGroupMemberRole(group.id, member.id, role);
      await loadAll();
      notify?.("Member role updated");
    } catch (roleError) {
      notify?.(roleError.message || "Could not update the member role");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={leaveOpen ? "Leave this group?" : "Cloud group members"}
      subtitle={leaveOpen ? `${group.name} · confirm before you lose access` : `${group.name} · manage people and invitations`}
      onClose={leaveOpen ? () => setLeaveOpen(false) : onClose}
      wide
    >
      {leaveOpen ? (
        <div className="form-stack">
          <div className="notice">
            <LogOut size={16}/> You will lose access to {group.name} and it will disappear from your Groups list and group switcher. The group itself — its members, expenses, settlements and history — stays with the remaining members.
          </div>
          {isLastOwner && (
            <p className="form-error" role="alert">You are the last owner of this group. Transfer ownership to another member before leaving — a group must always keep an owner.</p>
          )}
          {leaveError && <p className="form-error" role="alert">{leaveError}</p>}
          <div className="form-actions">
            <Button type="button" onClick={() => setLeaveOpen(false)} disabled={busy}>Cancel</Button>
            <Button type="button" variant="danger" onClick={confirmLeave} disabled={busy || isLastOwner}>
              <LogOut size={15}/> {busy ? "Leaving…" : "Leave group"}
            </Button>
          </div>
        </div>
      ) : loading ? (
        <Empty title="Loading members" detail="Fetching the secure group directory."/>
      ) : error ? (
        <Empty title="Could not load members" detail={error}/>
      ) : (
        <>
          <div className="member-list">
            {members.map((member) => (
              <div className="member-item" key={member.id}>
                <Avatar member={{ name: member.name, color: "lavender" }}/>
                <div className="member-copy">
                  <b>{member.name}</b>
                  <small>{member.id === authUserId ? "You · " : ""}{member.role}</small>
                </div>
                {member.id === authUserId && <span className="admin-pill">YOU</span>}
                {canRole && member.role !== "owner" ? (
                  <select
                    className="role-select"
                    value={member.role}
                    onChange={(event) => handleRole(member, event.target.value)}
                    disabled={busy}
                    aria-label={`Role for ${member.name}`}
                  >
                    <option value="member">member</option>
                    <option value="admin">admin</option>
                    <option value="owner">owner</option>
                  </select>
                ) : null}
                {member.id === authUserId ? (
                  <Button
                    type="button"
                    variant="danger"
                    onClick={openLeave}
                    disabled={busy || isLastOwner}
                    title={isLastOwner ? "Transfer ownership to another member before leaving" : "Leave this group"}
                  >
                    <LogOut size={15}/> Leave group
                  </Button>
                ) : canRemoveMember({ requesterRole: myRole, targetRole: member.role, ownerCount, requesterId: authUserId, targetId: member.id }) ? (
                  <Button
                    type="button"
                    variant="danger"
                    onClick={() => handleRemove(member)}
                    disabled={busy}
                    title={`Remove ${member.name} from this group`}
                  >
                    <Trash2 size={15}/> Remove
                  </Button>
                ) : null}
              </div>
            ))}
          </div>

          {isLastOwner && (
            <div className="notice">
              <ShieldAlert size={16}/> You are the last owner of this group. Transfer ownership to another member before leaving — a group must always keep an owner.
            </div>
          )}

          {canInvite ? (
            <div className="add-members-form">
              <div className="invite-link-block">
                <div className="invite-link-head">
                  <div>
                    <h3><LinkIcon size={16}/> Reusable invite link</h3>
                    <p>One link anyone can use to join this group until you revoke it.</p>
                  </div>
                  {link?.status === "active" && <span className="admin-pill">ACTIVE</span>}
                  {link && link.status === "revoked" && <span className="admin-pill">REVOKED</span>}
                  {link && link.status === "expired" && <span className="admin-pill">EXPIRED</span>}
                </div>

                {link && link.status === "active" ? (
                  <>
                    {linkUrl ? (
                      <div className="copy-url">{linkUrl}</div>
                    ) : (
                      <div className="notice">
                        <CircleHelp size={16}/> This link is active, but its URL is only stored on the device that created it. Revoke and create a new link to get a fresh copy.
                      </div>
                    )}
                    {linkUrl && (
                      <Button variant="primary" onClick={() => copyInvite(linkUrl)}>
                        <Clipboard size={16}/> Copy link
                      </Button>
                    )}
                    <Button onClick={handleRevokeLink} disabled={linkBusy}>
                      <Trash2 size={16}/> Revoke link
                    </Button>
                    <small className="muted-text">Expires {new Date(link.expiresAt).toLocaleDateString()}.</small>
                  </>
                ) : (
                  <Button variant="primary" onClick={handleCreateLink} disabled={linkBusy}>
                    <RotateCcw size={16}/> {link && link.status !== "active" ? "Create new link" : "Create invite link"}
                  </Button>
                )}

                {linkError && <p className="form-error" role="alert">{linkError}</p>}
              </div>

              <form className="form-stack" onSubmit={handleInvite}>
                <label>
                  <UserPlus size={15}/> Invite by email
                  <input
                    type="email"
                    required
                    placeholder="friend@example.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    disabled={busy}
                  />
                  <small>They join after signing in with this email and accepting the link.</small>
                </label>
                {formError && <p className="form-error" role="alert">{formError}</p>}
                <Button type="submit" variant="primary" disabled={busy}>
                  <LinkIcon size={16}/> Create email invite
                </Button>
              </form>

              {createdInvite && (
                <div className="invite-preview">
                  <div className="invite-large-icon"><LinkIcon size={24}/></div>
                  <h3>{createdInvite.email}</h3>
                  <p>Share this link · expires in 7 days</p>
                  <div className="copy-url">{createdInvite.url}</div>
                  <Button variant="primary" onClick={() => copyInvite(createdInvite.url)}>
                    <Clipboard size={16}/> Copy invite link
                  </Button>
                  <div className="notice">
                    <CircleHelp size={16}/> Anyone can preview this invite, but only {createdInvite.email} can accept it.
                  </div>
                </div>
              )}

              {invitations.length > 0 && (
                <div className="member-list">
                  {invitations.map((invitation) => (
                    <div className="member-item" key={invitation.id}>
                      <Avatar member={{ name: invitation.email, color: "mint" }}/>
                      <div className="member-copy">
                        <b>{invitation.email}</b>
                        <small>Invitation · {invitationStatusLabel(invitation.status)}</small>
                      </div>
                      {invitation.status === "pending" ? (
                        <button
                          className="icon-btn danger"
                          title="Revoke invitation"
                          onClick={() => handleRevoke(invitation)}
                          disabled={busy}
                        >
                          <Trash2 size={15}/>
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="notice">
              <CircleHelp size={16}/> Only group owners and admins can invite or manage members.
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
function InvitationScreen({ token, authUser, onClose, onJoined }) {
  const [state, setState] = useState({ status: "loading", preview: null, error: "", joining: false, joined: null });

  useEffect(() => {
    let cancelled = false;

    previewInvitation(token)
      .then((preview) => {
        if (cancelled) return;

        if (!preview) {
          setState({ status: "invalid", preview: null, error: "This invitation link is not valid.", joining: false, joined: null });
        } else {
          setState({ status: "ready", preview, error: "", joining: false, joined: null });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setState({ status: "invalid", preview: null, error: error.message || "Could not load this invitation.", joining: false, joined: null });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleAccept() {
    setState((current) => ({ ...current, joining: true, error: "" }));

    try {
      const result = await acceptInvitation(token);
      setState((current) => ({ ...current, joining: false, status: "joined", joined: result }));
    } catch (error) {
      setState((current) => ({ ...current, joining: false, error: error.message || "Could not accept the invitation." }));
    }
  }

  const preview = state.preview;
  const expiresLabel = preview?.expires_at
    ? new Date(preview.expires_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    : null;

  let body;

  if (state.status === "loading") {
    body = <Empty title="Checking invitation" detail="Verifying this invite link..."/>;
  } else if (state.status === "invalid") {
    body = (
      <>
        <Empty title="Invitation unavailable" detail={state.error}/>
        <div className="form-actions"><Button variant="primary" onClick={onClose}>Continue to SplitSmart</Button></div>
      </>
    );
  } else if (state.status === "joined") {
    body = (
      <div className="invite-preview">
        <div className="invite-large-icon"><Check size={24}/></div>
        <h3>You're in!</h3>
        <p>You joined {state.joined?.group_name || preview?.group_name || "the group"}.</p>
        <Button variant="primary" onClick={onJoined}>Go to my groups</Button>
      </div>
    );
  } else if (preview?.status === "pending" || preview?.status === "active") {
    const mismatch = authUser?.email
      && preview.invited_email
      && normalizeEmail(authUser.email) !== normalizeEmail(preview.invited_email);

    body = (
      <div className="invite-preview">
        <div className="invite-large-icon"><UsersRound size={24}/></div>
        <h3>{preview.group_name}</h3>
        <p>{preview.kind === "link" ? "You've been invited to join this group via a share link." : "You've been invited to join this group as a member."}</p>
        {preview.invited_email && <div className="copy-url">Invitation for {preview.invited_email}</div>}
        {expiresLabel && <p className="muted-text">Expires {expiresLabel}</p>}
        {mismatch && (
          <div className="notice">
            <CircleHelp size={16}/> You're signed in as {authUser.email}, but this invite was sent to {preview.invited_email}.
          </div>
        )}
        {state.error && <div className="form-error" role="alert">{state.error}</div>}
        <Button variant="primary" onClick={handleAccept} disabled={state.joining}>
          {state.joining ? "Joining..." : "Accept invitation"}
        </Button>
        <Button onClick={onClose}>Not now</Button>
      </div>
    );
  } else {
    const message = preview?.status === "accepted"
      ? "This invitation has already been accepted."
      : preview?.status === "revoked"
        ? "This invitation has been revoked."
        : preview?.status === "expired"
          ? "This invitation has expired."
          : "This invitation is no longer available.";

    body = (
      <>
        <Empty title="Invitation unavailable" detail={message}/>
        <div className="form-actions"><Button variant="primary" onClick={onClose}>Continue to SplitSmart</Button></div>
      </>
    );
  }

  return <Modal title="Group invitation" subtitle="Secure invitation to a SplitSmart cloud group." onClose={onClose}>{body}</Modal>;
}
function ExpenseModal({ group, members, currentUserId, expense, bill, recurringMode, defaultSplitMethod = "equal", onClose, onSave, onSaveRecurring }) {
  const [form, setForm] = useState(() => {
    if (bill) return { title: bill.title, amount: String(bill.amount), category: bill.category, paidById: bill.paidById, date: bill.startDate || currentDate(), notes: bill.notes || "", splitMethod: bill.splitMethod || "equal", participantIds: bill.participantIds || members.map((m) => m.id), shareValues: Object.fromEntries(Object.entries(bill.splitValues || {}).map(([id, v]) => [id, String(v)])) };
    if (expense) return { title: expense.title, amount: String(expense.amount), category: expense.category, paidById: expense.paidById, date: expense.date || currentDate(), notes: expense.notes || "", splitMethod: expense.splitMethod || "equal", participantIds: expense.participantIds || members.map((m) => m.id), shareValues: Object.fromEntries(Object.entries(expense.shares || {}).map(([id, v]) => [id, String(v)])) };
    const ids = members.map((m) => m.id);
    const method = ["equal", "exact", "percentage"].includes(defaultSplitMethod) ? defaultSplitMethod : "equal";
    const shareValues = method === "percentage" && ids.length ? Object.fromEntries(ids.map((id, i) => [id, i === ids.length - 1 ? String(100 - Math.floor(10000 / ids.length) / 100 * (ids.length - 1)) : String(Math.floor(10000 / ids.length) / 100)])) : {};
    return { title: "", amount: "", category: "Groceries", paidById: currentUserId, date: currentDate(), notes: "", splitMethod: method, participantIds: ids, shareValues };
  });
  const update = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const toggleMember = (id) => {
    const nextIds = form.participantIds.includes(id) ? form.participantIds.filter((x) => x !== id) : [...form.participantIds, id];
    setForm((f) => ({ ...f, participantIds: nextIds, shareValues: f.splitMethod === "percentage" && nextIds.length ? Object.fromEntries(nextIds.map((memberId, i) => [memberId, i === nextIds.length - 1 ? String(100 - Math.floor(10000 / nextIds.length) / 100 * (nextIds.length - 1)) : String(Math.floor(10000 / nextIds.length) / 100)])) : f.shareValues }));
  };
  const amount = Number(form.amount) || 0;
  const equalShare = form.participantIds.length ? amount / form.participantIds.length : 0;
  const methodLabels = { equal: "Equal split", exact: "Exact amounts", percentage: "Percentages" };
  const [recurring, setRecurring] = useState(Boolean(bill) || Boolean(recurringMode));
  const [frequency, setFrequency] = useState(bill?.frequency || "monthly");
  const [endDate, setEndDate] = useState(bill?.endDate || "");
  const isRecurring = !expense && recurring;
  const showRecurringToggle = Boolean(onSaveRecurring) && !expense && !bill;
  const buildRecurringConfig = () => ({
    title: form.title,
    amount: form.amount,
    category: form.category,
    paidById: form.paidById,
    startDate: form.date,
    endDate: endDate || null,
    frequency,
    splitMethod: form.splitMethod,
    participantIds: form.participantIds,
    splitValues: Object.fromEntries(Object.entries(form.shareValues || {}).map(([id, value]) => [id, Number(value)])),
    notes: form.notes,
  });
  return <Modal title={bill ? "Edit recurring bill" : isRecurring ? "Create a recurring bill" : expense ? "Edit expense" : "Add an expense"} subtitle={isRecurring ? `Set up a repeating shared cost in ${group.name}.` : `Record a shared cost in ${group.name}.`} onClose={onClose} wide><form className="form-stack" onSubmit={(e) => { e.preventDefault(); if (isRecurring) { const config = buildRecurringConfig(); try { validateRecurringConfig(config); } catch (validationError) { window.alert(validationError.message); return; } onSaveRecurring(config); } else { onSave(form); } }}><div className="form-two-col"><label>Expense name<input required maxLength="100" placeholder="e.g. Dinner, groceries" value={form.title} onChange={(e) => update("title", e.target.value)}/></label><label>Amount (₹)<input required type="number" min="0.01" step="0.01" placeholder="0.00" value={form.amount} onChange={(e) => update("amount", e.target.value)}/></label><label>Category<select value={form.category} onChange={(e) => update("category", e.target.value)}>{categories.map((c) => <option key={c}>{c}</option>)}</select></label><label>Paid by<select value={form.paidById} onChange={(e) => update("paidById", e.target.value)}>{members.map((m) => <option value={m.id} key={m.id}>{m.name}{m.id === currentUserId ? " (you)" : ""}</option>)}</select></label><label>{isRecurring ? "Start date" : "Date"}<input type="date" value={form.date} onChange={(e) => update("date", e.target.value)} required/></label><label>Split method<select value={form.splitMethod} onChange={(e) => { const method = e.target.value; update("splitMethod", method); update("shareValues", method === "percentage" && form.participantIds.length ? Object.fromEntries(form.participantIds.map((id, i) => [id, i === form.participantIds.length - 1 ? String(100 - Math.floor(10000 / form.participantIds.length) / 100 * (form.participantIds.length - 1)) : String(Math.floor(10000 / form.participantIds.length) / 100)])) : {}); }}>{Object.entries(methodLabels).map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label></div><label>Who shares this expense?</label><div className="participant-grid">{members.map((m) => <label className={`participant-option ${form.participantIds.includes(m.id) ? "selected" : ""}`} key={m.id}><input type="checkbox" checked={form.participantIds.includes(m.id)} onChange={() => toggleMember(m.id)}/><Avatar member={m} small/><span>{m.name}{m.id === currentUserId ? " (you)" : ""}</span></label>)}</div>
    {form.splitMethod !== "equal" && <div className="custom-shares"><div className="custom-shares-heading"><b>{form.splitMethod === "exact" ? "Share amount per person" : "Share percentage per person"}</b><small>{form.splitMethod === "exact" ? `Must total ${money(amount)}` : "Percentages must total 100%"}</small></div>{form.participantIds.map((id) => <label className="share-input-row" key={id}><span>{members.find((m) => m.id === id)?.name}</span><input type="number" min="0" step={form.splitMethod === "exact" ? "0.01" : "0.01"} placeholder={form.splitMethod === "percentage" ? (form.participantIds.length ? (100/form.participantIds.length).toFixed(2) : "0") : "0.00"} value={form.shareValues[id] ?? (form.splitMethod === "percentage" && form.participantIds.length ? (100/form.participantIds.length).toFixed(2) : "")} onChange={(e) => update("shareValues", { ...form.shareValues, [id]: e.target.value })} required/></label>)}{form.splitMethod === "equal" && <small>Each person's share is about {money(equalShare)}.</small>}</div>}
    {form.splitMethod === "equal" && <div className="split-preview"><span>Estimated share per person</span><b>{money(equalShare)}</b><small>Any rounding remainder is distributed by paise.</small></div>}    {showRecurringToggle && <div className="recurring-block"><label className="recurring-toggle"><input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)}/><span><Repeat size={15}/> Make this a recurring bill</span></label></div>}
    {isRecurring && <div className="recurring-block"><div className="recurring-fields"><label>Frequency<select value={frequency} onChange={(e) => setFrequency(e.target.value)}>{RECURRING_FREQUENCIES.map((value) => <option value={value} key={value}>{FREQUENCY_LABELS[value]}</option>)}</select></label><label>End date <span className="muted-text">(optional)</span><input type="date" value={endDate} min={form.date} onChange={(e) => setEndDate(e.target.value)}/></label></div><div className="notice"><CircleHelp size={16}/> No money moves automatically. You'll record each payment when it's due, which adds a normal expense to the ledger.</div></div>}
    <label>Notes <span className="muted-text">(optional)</span><textarea rows="2" placeholder="Add a note for your group" value={form.notes} onChange={(e) => update("notes", e.target.value)}/></label><div className="form-actions"><Button type="button" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary"><Check size={16}/>{isRecurring ? (bill ? "Save changes" : "Create recurring bill") : expense ? "Save changes" : "Add expense"}</Button></div></form></Modal>;
}
function RecurringBillsPage({ bills, occurrences, members, membersById, currentUserId, loading, error, onCreate, onEdit, onRecord, onStatus }) {
  const [tab, setTab] = useState("upcoming");
  const [expandedId, setExpandedId] = useState("");
  const tabs = [
    { id: "upcoming", label: "Upcoming" },
    { id: "active", label: "Active" },
    { id: "paused", label: "Paused" },
    { id: "completed", label: "Completed" },
  ];
  const buckets = bucketRecurringBills(bills);
  const myRole = membersById[currentUserId]?.role;
  const canManage = (bill) => bill.createdBy === currentUserId || myRole === "owner" || myRole === "admin";
  const list = buckets[tab] || [];
  const emptyText = {
    upcoming: "No bills are due in the next 30 days.",
    active: "No active recurring bills yet.",
    paused: "No paused recurring bills.",
    completed: "No completed or cancelled bills.",
  };

  return (
    <div className="page-wrap">
      <PageHeading eyebrow="SET IT AND FORGET IT" title="Recurring Bills" subtitle="Track repeating costs and record each payment when it's due." action={<Button variant="primary" onClick={onCreate}><Plus size={17}/> New recurring bill</Button>}/>
      {loading ? (
        <Empty title="Loading recurring bills" detail="Fetching schedules for this group."/>
      ) : error ? (
        <section className="panel"><Empty title="Could not load recurring bills" detail={error}/></section>
      ) : (
        <>
          <div className="tab-bar">{tabs.map((item) => <button key={item.id} className={`tab ${tab === item.id ? "active" : ""}`} onClick={() => setTab(item.id)}>{item.label}<span className="tab-count">{(buckets[item.id] || []).length}</span></button>)}</div>
          <section className="panel">
            {list.length ? list.map((bill) => {
              const history = occurrencesForBill(occurrences, bill.id);
              const due = isBillDue(bill);
              return (
                <article className={`bill-card ${due ? "due" : ""}`} key={bill.id}>
                  <div className="bill-card-head">
                    <div className={`bill-icon ${due ? "peach" : "lavender"}`}><CalendarClock size={20}/></div>
                    <div className="bill-main">
                      <b>{bill.title}</b>
                      <span>{money(bill.amount)} · {frequencyLabel(bill.frequency)} · paid by {membersById[bill.paidById]?.name || "Member"}</span>
                    </div>
                    <div className="bill-meta">
                      <span className={`status-pill ${bill.status}`}>{statusLabel(bill.status)}</span>
                      <b>{displayDate(bill.nextDueDate)}</b>
                      <small className={due ? "due-pill" : "muted-text"}>{dueLabel(bill)}</small>
                    </div>
                  </div>
                  <div className="bill-facts">
                    <span><UsersRound size={14}/> {bill.participantIds.length} participants</span>
                    <span><Repeat size={14}/> {frequencyLabel(bill.frequency)}</span>
                    {bill.endDate && <span>Ends {displayDate(bill.endDate)}</span>}
                    <span><Check size={14}/> {history.length} recorded</span>
                  </div>
                  <div className="bill-actions">
                    {bill.status === "active" && <Button variant="primary" onClick={() => onRecord(bill)}><Check size={15}/> Record payment</Button>}
                    {canManage(bill) && <Button onClick={() => onEdit(bill)}><Pencil size={15}/> Edit</Button>}
                    {canManage(bill) && bill.status === "active" && <Button onClick={() => onStatus(bill, "paused")}><Pause size={15}/> Pause</Button>}
                    {canManage(bill) && bill.status === "paused" && <Button onClick={() => onStatus(bill, "active")}><Play size={15}/> Resume</Button>}
                    {canManage(bill) && (bill.status === "active" || bill.status === "paused") && <Button variant="danger" onClick={() => { if (window.confirm("Cancel this recurring bill? Already recorded expenses are kept.")) onStatus(bill, "cancelled"); }}><X size={15}/> Cancel</Button>}
                    <button className="text-link" onClick={() => setExpandedId(expandedId === bill.id ? "" : bill.id)}>{expandedId === bill.id ? "Hide history" : `History (${history.length})`}</button>
                  </div>
                  {expandedId === bill.id && <div className="bill-history">{history.length ? history.map((row) => <div className="bill-history-row" key={row.id}><span>{displayDate(row.occurrenceDate)}</span><span>{money(bill.amount)}</span><small>Recorded</small></div>) : <small className="muted-text">No payments recorded yet.</small>}</div>}
                </article>
              );
            }) : <Empty title={emptyText[tab]} detail="Use New recurring bill to set up a repeating cost."/>}
          </section>
        </>
      )}
    </div>
  );
}
function ChangePasswordCard({ email }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const strength = passwordStrength(password);
  const strengthLabel = passwordStrengthLabel(password);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setStatus("");

    let next;
    try {
      next = validatePasswordChange({ password, confirm });
    } catch (validationError) {
      setError(validationError.message);
      return;
    }

    setBusy(true);
    try {
      await changePassword(next);
      setPassword("");
      setConfirm("");
      setStatus("Password updated. Use it the next time you sign in.");
    } catch (updateError) {
      setError(updateError?.message || "Could not update your password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel settings-section">
      <div className="panel-heading"><div><h2><KeyRound size={18}/> Password</h2><p>Update the password for {email}.</p></div></div>
      <form className="settings-password" onSubmit={submit}>
        <label className="settings-field"><span>New password</span>
          <div className="password-input">
            <input
              type={show ? "text" : "password"}
              value={password}
              onChange={(event) => { setError(""); setStatus(""); setPassword(event.target.value); }}
              autoComplete="new-password"
              minLength={8}
              maxLength={72}
              placeholder="Enter a new password"
            />
            <button
              type="button"
              className="icon-btn password-toggle"
              onClick={() => setShow((value) => !value)}
              aria-label={show ? "Hide password" : "Show password"}
              title={show ? "Hide password" : "Show password"}
            >
              {show ? <EyeOff size={16}/> : <Eye size={16}/>}
            </button>
          </div>
          {password && (
            <div className={`password-strength level-${strength}`}>
              <span className="password-strength-track"><i style={{ width: `${Math.max(strength, 1) * 25}%` }}/></span>
              <span className="password-strength-label">{strengthLabel}</span>
            </div>
          )}
          <small>Use at least 8 characters, including a letter and a number. Passwords are never stored by SplitSmart.</small>
        </label>

        <label className="settings-field"><span>Confirm new password</span>
          <input
            type={show ? "text" : "password"}
            value={confirm}
            onChange={(event) => { setError(""); setStatus(""); setConfirm(event.target.value); }}
            autoComplete="new-password"
            minLength={8}
            maxLength={72}
            placeholder="Re-enter the new password"
          />
        </label>

        {error && <p className="form-error" role="alert">{error}</p>}
        {status && <div className="notice settings-alert success"><Check size={16}/> {status}</div>}

        <div className="settings-actions">
          <Button variant="primary" type="submit" disabled={busy || !password || !confirm}>{busy ? "Updating…" : "Update password"}</Button>
        </div>
      </form>
    </section>
  );
}

function DeleteAccountCard({ onDeleted }) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState("");
  const [previewBusy, setPreviewBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const canDelete = status ? status.can_delete !== false : true;
  const blockers = status?.blockers || [];
  const soleGroups = status?.sole_member_groups || [];
  const confirmed = isDeletionConfirmed(confirmText);

  async function openDialog() {
    setError("");
    setConfirmText("");
    setStatus(null);
    setStatusError("");
    setOpen(true);
    setPreviewBusy(true);
    try {
      setStatus(await fetchDeletionStatus());
    } catch (previewError) {
      setStatusError(previewError?.message || "Could not check your account status.");
    } finally {
      setPreviewBusy(false);
    }
  }

  async function confirmDelete() {
    if (!isDeletionConfirmed(confirmText)) {
      setError(`Type ${DELETION_CONFIRMATION} to confirm.`);
      return;
    }

    setBusy(true);
    setError("");

    try {
      const result = await requestAccountDeletion();
      await onDeleted?.(result);
    } catch (deleteError) {
      setError(deleteError?.message || "Could not delete your account.");
      setBusy(false);
    }
  }

  return (
    <section className="panel settings-section danger-zone">
      <div className="panel-heading"><div><h2><ShieldAlert size={18}/> Danger zone</h2><p>Permanently delete your SplitSmart account.</p></div></div>
      <div className="danger-zone-body">
        <div>
          <b>Delete account</b>
          <small>Your private data and groups you own alone are removed. Shared expense history and other members&apos; balances are preserved, so you may need to resolve shared groups first.</small>
        </div>
        <Button type="button" variant="danger" onClick={openDialog}><Trash2 size={15}/> Delete account</Button>
      </div>

      {open && (
        <Modal title="Delete your account?" subtitle="This is permanent and cannot be undone." onClose={() => { if (!busy) setOpen(false); }}>
          <div className="notice settings-alert error"><ShieldAlert size={16}/> Deleting your account permanently removes your profile, personal expenses, notifications, preferences, and any group you own alone. Shared groups are never deleted for other members.</div>

          {previewBusy && <p className="muted">Checking what would be removed…</p>}

          {!previewBusy && blockers.length > 0 && (
            <div className="deletion-blockers">
              <b>Resolve these before deleting:</b>
              <ul>
                {blockers.map((blocker, index) => (
                  <li key={`${blocker.group_id || "g"}-${index}`}>
                    <b>{blocker.group_name || "Group"}</b> — {blocker.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!previewBusy && canDelete && (
            <p className="muted">{status?.message || "Your account can be deleted."}{soleGroups.length ? ` ${soleGroups.length} group${soleGroups.length === 1 ? "" : "s"} you own alone will be removed.` : ""}</p>
          )}

          {statusError && <p className="form-error" role="alert">{statusError}</p>}

          <label className="settings-field"><span>Type <code>{DELETION_CONFIRMATION}</code> to confirm</span>
            <input
              value={confirmText}
              onChange={(event) => { setError(""); setConfirmText(event.target.value); }}
              placeholder={DELETION_CONFIRMATION}
              autoComplete="off"
              disabled={busy}
            />
          </label>

          {error && <p className="form-error" role="alert">{error}</p>}

          <div className="form-actions">
            <Button type="button" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button type="button" variant="danger" onClick={confirmDelete} disabled={busy || !confirmed || !canDelete}>
              <Trash2 size={15}/> {busy ? "Deleting…" : "Delete my account"}
            </Button>
          </div>
        </Modal>
      )}
    </section>
  );
}

function SettingsPage({ authUser, profile, loading, error, saving, preferences, onSave, onOpenProfile, onAccountDeleted }) {
  const [form, setForm] = useState(preferences);
  const [status, setStatus] = useState("");
  const [saveError, setSaveError] = useState("");

  useEffect(() => { setForm(preferences); }, [preferences]);

  const displayName = getProfileDisplayName(authUser, profile);
  const email = authUser?.email || "No email on file";

  const update = (key, value) => {
    setStatus("");
    setSaveError("");
    setForm((current) => ({ ...current, [key]: value }));
  };

  const submit = async (event) => {
    event.preventDefault();
    setStatus("");
    setSaveError("");
    try {
      await onSave(form);
      setStatus("Preferences saved.");
    } catch (err) {
      setSaveError(err?.message || "Could not save your preferences.");
    }
  };

  const notifications = [
    { key: "notifyRecurringBills", label: "Upcoming recurring bill reminders", detail: "Get notified before a recurring bill is due." },
    { key: "notifyInvitations", label: "Group invitation notifications", detail: "Get notified when someone invites you to a group." },
    { key: "notifyActivity", label: "Expense & settlement activity", detail: "Get notified about new expenses and recorded settlements." },
  ];

  return <div className="page-wrap"><PageHeading eyebrow="MAKE IT YOURS" title="Settings" subtitle="Your personal preferences. Only you can see or change them."/>

    {error && <div className="notice settings-alert"><CircleHelp size={16}/> We couldn't load your saved preferences ({error}). If this is the first run, apply the <code>user_preferences</code> migration in Supabase.</div>}
    {saveError && <div className="notice settings-alert error"><CircleHelp size={16}/> {saveError}</div>}
    {status && <div className="notice settings-alert success"><Check size={16}/> {status}</div>}

    <form className="settings-form" onSubmit={submit}>
      <section className="panel settings-section">
        <div className="panel-heading"><div><h2><User size={18}/> Account</h2><p>Your name and email come from your account.</p></div></div>
        <div className="settings-account">
          <Avatar member={{ name: displayName }} />
          <div className="settings-account-info"><b>{displayName}</b><span>{email}</span></div>
          <Button type="button" onClick={onOpenProfile}><Pencil size={15}/> Manage profile</Button>
        </div>
      </section>

      <section className="panel settings-section">
        <div className="panel-heading"><div><h2><Wallet size={18}/> Preferences</h2><p>How new expenses are prepared for you.</p></div></div>
        <label className="settings-field"><span>Default currency</span>
          <div className="settings-readonly">INR (₹)</div>
          <small>SplitSmart currently stores and calculates every amount in rupees (INR). Multi-currency would need a larger schema change, so INR is the only supported currency for now.</small>
        </label>
        <label className="settings-field"><span>Default split method</span>
          <select value={form.defaultSplitMethod} onChange={(e) => update("defaultSplitMethod", e.target.value)}>
            {SPLIT_METHODS.map((method) => <option key={method} value={method}>{SPLIT_METHOD_LABELS[method]}</option>)}
          </select>
          <small>Used when you open Add Expense. You can still change the split for any individual expense.</small>
        </label>
      </section>

      <section className="panel settings-section">
        <div className="panel-heading"><div><h2><Bell size={18}/> Notifications</h2><p>Choose which updates you'd like to hear about.</p></div></div>
        {notifications.map((item) => <label className="settings-toggle" key={item.key}>
          <span><b>{item.label}</b><small>{item.detail}</small></span>
          <input type="checkbox" checked={Boolean(form[item.key])} onChange={(e) => update(item.key, e.target.checked)}/>
        </label>)}
        <div className="notice"><CircleHelp size={16}/> In-app notifications for group activity and invitations are live — you'll see them in the bell menu. Email, push, and scheduled reminders aren't available yet; these preferences already control what appears in-app.</div>
      </section>

      <section className="panel settings-section">
        <div className="panel-heading"><div><h2><CalendarClock size={18}/> Recurring Bills</h2><p>Defaults for recurring bill reminders.</p></div></div>
        <label className="settings-field"><span>Reminder lead time</span>
          <select value={form.reminderLeadDays} onChange={(e) => update("reminderLeadDays", Number(e.target.value))}>
            {REMINDER_LEAD_DAYS.map((days) => <option key={days} value={days}>{days} {days === 1 ? "day" : "days"} before due</option>)}
          </select>
          <small>Automatic reminders aren't active yet. This preference is saved now and used when reminder scheduling is added.</small>
        </label>
      </section>

      <div className="settings-actions">
        <Button variant="primary" type="submit" disabled={loading || saving}>{saving ? "Saving…" : "Save preferences"}</Button>
        {loading && <span className="muted">Loading your settings…</span>}
      </div>
    </form>

    <div className="settings-form settings-security">
      <ChangePasswordCard email={email}/>
      <DeleteAccountCard onDeleted={onAccountDeleted}/>
    </div>
  </div>;
}
function BalancesPage({ group, members, membersById, balances, transfers, settlements, currentUserId, onSettle }) {
  const [showHistory, setShowHistory] = useState(false);
  return <div className="page-wrap"><PageHeading eyebrow="SETTLE UP, STRESS LESS" title="Balances" subtitle={`Who owes whom in ${group.name} — simplified to the fewest payments.`}/><div className="balance-banner"><div><span className="eyebrow">NET BALANCE · YOU</span><h2>{(balances[currentUserId] || 0) > 0.009 ? "+" : (balances[currentUserId] || 0) < -0.009 ? "−" : ""}{money(Math.abs(balances[currentUserId] || 0))}</h2><p>{(balances[currentUserId] || 0) > 0.009 ? "You are owed money overall." : (balances[currentUserId] || 0) < -0.009 ? "You owe money overall." : "You're all settled in this group."}</p></div><span className="balance-banner-icon"><ArrowLeftRight size={25}/></span></div><div className="content-grid balances-layout"><section className="panel"><div className="panel-heading"><div><h2>Suggested settlements</h2><p>Smartest plan: {transfers.length} {transfers.length === 1 ? "payment" : "payments"} settle this group.</p></div></div>{transfers.length ? transfers.map((t, i) => <div className="transfer-row" key={`${t.fromId}-${t.toId}-${i}`}><div className="transfer-people"><Avatar member={membersById[t.fromId]}/><div><b>{membersById[t.fromId]?.name || "Member"}</b><small>pays</small></div><ArrowLeftRight size={17} className="muted"/><Avatar member={membersById[t.toId]}/><div><b>{membersById[t.toId]?.name || "Member"}</b><small>receives</small></div></div><div className="transfer-action"><strong>{money(t.amount)}</strong><Button variant="primary" onClick={() => onSettle(t)} disabled={t.fromId !== currentUserId} title={t.fromId !== currentUserId ? "Only the payer can record this settlement" : undefined}>Record payment</Button></div></div>) : <Empty title="All settled!" detail="No outstanding balances in this group."/>}<div className="notice"><CircleHelp size={16}/> Payments happen outside SplitSmart in this prototype. Recording a payment updates the group's ledger.</div></section><section className="panel"><div className="panel-heading"><div><h2>Net balances</h2><p>Positive means owed money; negative means owes money.</p></div></div>{members.map((m) => <div className="mini-balance" key={m.id}><Avatar member={m} small/><span>{m.id === currentUserId ? "You" : m.name}</span><b className={(balances[m.id] || 0) > .009 ? "positive" : (balances[m.id] || 0) < -.009 ? "negative" : "neutral"}>{(balances[m.id] || 0) > .009 ? "+" : (balances[m.id] || 0) < -.009 ? "−" : ""}{money(Math.abs(balances[m.id] || 0))}</b></div>)}<button className="text-link history-toggle" onClick={() => setShowHistory((v) => !v)}>{showHistory ? "Hide" : "Show"} settlement history <ChevronDown size={15}/></button>{showHistory && (settlements.length ? settlements.map((s) => <div className="history-row" key={s.id}><Check size={15}/><span>{membersById[s.fromId]?.name} paid {membersById[s.toId]?.name}</span><b>{money(s.amount)}</b><small>{displayDate(s.date)}</small></div>) : <p className="muted-text">No settlements recorded yet.</p>)}</section></div></div>;
}
function SettlementModal({ transfer, membersById, currentUserId, onClose, onSave }) {
  const [amount, setAmount] = useState(String(transfer.amount));
  const [step, setStep] = useState("form");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isPayer = transfer.fromId === currentUserId;
  const fromName = membersById[transfer.fromId]?.name || "Member";
  const toName = membersById[transfer.toId]?.name || "Member";

  function goToConfirm(event) {
    event.preventDefault();
    setError("");

    const value = Math.round(Number(amount) * 100) / 100;

    if (!Number.isFinite(value) || value <= 0) {
      setError("Enter a valid settlement amount.");
      return;
    }

    if (value > Number(transfer.amount) + 0.005) {
      setError(`Enter an amount up to ${money(transfer.amount)}.`);
      return;
    }

    setAmount(String(value));
    setStep("confirm");
  }

  async function confirm() {
    if (busy) return;

    setBusy(true);
    setError("");

    try {
      await onSave(transfer, amount);
    } catch (saveError) {
      setError(saveError?.message || "Could not record the settlement.");
    } finally {
      setBusy(false);
    }
  }

  if (step === "confirm") {
    return <Modal title="Confirm settlement" subtitle="No money moves inside SplitSmart; this only records a payment that already happened." onClose={onClose}><div className="settlement-preview"><div className="settlement-person"><Avatar member={membersById[transfer.fromId]}/><b>{fromName}</b><small>pays</small></div><ArrowLeftRight size={20}/><div className="settlement-person"><Avatar member={membersById[transfer.toId]}/><b>{toName}</b><small>receives</small></div></div><div className="settlement-confirm-total"><span>Amount to record</span><b>{money(amount)}</b></div><div className="notice"><CircleHelp size={16}/> Confirm that {fromName} paid {toName} {money(amount)} outside SplitSmart.</div>{error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions"><Button type="button" onClick={() => setStep("form")} disabled={busy}>Back</Button><Button variant="primary" onClick={confirm} disabled={busy}><Check size={16}/> {busy ? "Recording..." : "Confirm payment"}</Button></div></Modal>;
  }

  return <Modal title="Record a settlement" subtitle="Record an external payment; no money moves inside SplitSmart." onClose={onClose}><div className="settlement-preview"><div className="settlement-person"><Avatar member={membersById[transfer.fromId]}/><b>{fromName}</b><small>pays</small></div><ArrowLeftRight size={20}/><div className="settlement-person"><Avatar member={membersById[transfer.toId]}/><b>{toName}</b><small>receives</small></div></div><form className="form-stack" onSubmit={goToConfirm}><label>Payment amount (₹)<input type="number" min="0.01" max={transfer.amount} step="0.01" value={amount} onChange={(e) => { setError(""); setAmount(e.target.value); }} required/><small>Outstanding suggested amount: {money(transfer.amount)}</small></label>{!isPayer && <div className="notice"><CircleHelp size={16}/> Only the payer can record this settlement.</div>}{error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions"><Button type="button" onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" disabled={!isPayer}><Check size={16}/> Continue</Button></div></form></Modal>;
}

function InsightsPage({ expenses, total, members, membersById }) {
  const totals = categories.map((name) => ({ name, amount: expenses.filter((e) => e.category === name).reduce((sum, e) => sum + e.amount, 0) })).filter((c) => c.amount > 0).sort((a,b) => b.amount-a.amount);
  const max = Math.max(1, ...totals.map((c) => c.amount));
  const paidTotals = members.map((m) => ({ ...m, amount: expenses.filter((e) => e.paidById === m.id).reduce((sum,e) => sum+e.amount,0) })).sort((a,b) => b.amount-a.amount);
  return <div className="page-wrap"><PageHeading eyebrow="SPENDING, MADE CLEAR" title="Insights" subtitle="Understand where this group spends its money."/><div className="stats-grid"><StatCard icon={CircleDollarSign} label="Total spending" value={money(total)} detail={`${expenses.length} recorded expenses`} color="lavender"/><StatCard icon={ReceiptText} label="Average expense" value={money(expenses.length ? total/expenses.length : 0)} detail="Per transaction" color="mint"/><StatCard icon={UsersRound} label="Members" value={members.length} detail="In the selected group" color="blue"/></div><div className="content-grid insights-grid"><section className="panel"><div className="panel-heading"><div><h2>Spending by category</h2><p>Categories ranked by recorded total</p></div></div>{totals.length ? totals.map((c, i) => <div className="category-bar" key={c.name}><div className="category-bar-top"><span>{c.name}</span><b>{money(c.amount)}</b></div><div className="bar-track"><i style={{ width: `${c.amount/max*100}%` }} className={`bar-color-${i%5}`}/></div><small>{total ? `${(c.amount/total*100).toFixed(1)}% of total` : "0%"}</small></div>) : <Empty title="No data yet" detail="Add expenses to see category insights."/>}</section><section className="panel"><div className="panel-heading"><div><h2>Who paid?</h2><p>Total expenses initially paid by each member</p></div></div>{paidTotals.map((m) => <div className="payer-row" key={m.id}><Avatar member={m} small/><span>{m.name}</span><b>{money(m.amount)}</b></div>)}<div className="info-tip"><Sparkles size={16}/><span>Insights update automatically when you add, edit, or delete expenses.</span></div></section></div></div>;
}

function NotificationBell({ notifications, unread, loading, error, onMarkRead, onMarkAllRead, onRefresh, onNavigate }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    function handlePointer(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    }

    function handleKey(event) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const targetPage = (type) => {
    if (type === "settlement_recorded") return "Balances";
    if (type === "invitation_received") return "Groups";
    return "Expenses";
  };

  function handleToggle() {
    setOpen((value) => {
      const next = !value;
      if (next) onRefresh?.();
      return next;
    });
  }

  async function openNotification(notification) {
    if (!notification.readAt) await onMarkRead?.(notification.id);
    const page = targetPage(notification.type);
    if (page) onNavigate?.(page);
    setOpen(false);
  }

  return (
    <div className="notification-menu" ref={rootRef}>
      <button type="button" ref={buttonRef} className="icon-btn notification-bell" aria-haspopup="menu" aria-expanded={open} aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"} onClick={handleToggle}>
        <Bell size={18}/>
        {unread > 0 && <span className="notification-badge">{unread > 9 ? "9+" : unread}</span>}
      </button>

      {open && (
        <div className="notification-dropdown" role="menu" aria-label="Notifications">
          <div className="notification-dropdown-head">
            <div><b>Notifications</b><small>{unread > 0 ? `${unread} unread` : "You're all caught up"}</small></div>
            {unread > 0 && <button type="button" className="text-link" onClick={() => onMarkAllRead?.()}>Mark all read</button>}
          </div>
          <div className="notification-list">
            {loading ? (
              <div className="notification-empty">Loading notifications…</div>
            ) : error ? (
              <div className="notification-empty">{error}</div>
            ) : notifications.length === 0 ? (
              <div className="notification-empty">No notifications yet. Group activity will show up here.</div>
            ) : (
              notifications.map((notification) => (
                <button type="button" role="menuitem" key={notification.id} className={`notification-item ${notification.readAt ? "" : "unread"}`} onClick={() => openNotification(notification)}>
                  <span className={`notification-icon ${notificationTone(notification.type)}`}><ReceiptText size={15}/></span>
                  <span className="notification-copy">
                    <b>{notification.title}</b>
                    {notification.body && <small>{notification.body}</small>}
                    <span className="notification-meta">{notification.groupName ? `${notification.groupName} · ` : ""}{formatRelativeTime(notification.createdAt)}</span>
                  </span>
                  {notification.amount != null && <span className="notification-amount">{money(notification.amount)}</span>}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
function PersonalExpenseRow({ expense, onEdit, onDelete }) {
  const Icon = categoryIcons[expense.category] || CircleDollarSign;

  return (
    <div className="expense-row">
      <div className={`expense-icon ${expense.category === "Utilities" ? "yellow" : expense.category === "Food & drink" ? "pink" : "mint"}`}><Icon size={18}/></div>
      <div className="expense-main">
        <b>{expense.title}</b>
        <span>{expense.category} · {displayDate(expense.date)}{expense.notes ? ` · ${expense.notes}` : ""}</span>
      </div>
      <div className="expense-meta">
        <b>{money(expense.amount)}</b>
        <span>Personal</span>
      </div>
      <button type="button" className="secondary-button" onClick={() => onEdit(expense)}>Edit</button>
      <button type="button" className="secondary-button" onClick={() => onDelete(expense.id)}>Delete</button>
    </div>
  );
}
function PersonalExpensesPage({ expenses, loading, error, onAdd, onEdit, onDelete, onRetry }) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const summary = summarizePersonalExpenses(expenses);
  const list = filterPersonalExpenses(expenses, { search, category });

  return (
    <div className="page-wrap">
      <PageHeading eyebrow="JUST FOR YOU" title="Personal expenses" subtitle="Track your own spending outside any group. Only you can see these." action={<Button variant="primary" onClick={onAdd}><Plus size={17}/> Add personal expense</Button>}/>
      <section className="stats-grid">
        <StatCard icon={Wallet} label="Personal spending" value={money(summary.total)} detail={`${summary.count} ${summary.count === 1 ? "expense" : "expenses"} recorded`} color="lavender"/>
        <StatCard icon={ReceiptText} label="Average expense" value={money(summary.average)} detail="Per personal expense" color="mint"/>
        <StatCard icon={CircleDollarSign} label="Top category" value={summary.topCategory || "—"} detail={summary.topCategory ? money(summary.topCategoryAmount) : "No spending yet"} color="blue"/>
      </section>
      <section className="panel">
        <div className="toolbar">
          <div className="search-box"><Search size={17}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search personal expenses..."/></div>
          <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filter by category"><option>All</option>{PERSONAL_EXPENSE_CATEGORIES.map((name) => <option key={name}>{name}</option>)}</select>
        </div>
        {loading ? (
          <Empty title="Loading personal expenses" detail="Fetching your private ledger."/>
        ) : error ? (
          <><Empty title="Could not load personal expenses" detail={error}/><div className="panel-bottom"><Button onClick={onRetry}>Try again</Button></div></>
        ) : list.length ? (
          list.map((expense) => <PersonalExpenseRow key={expense.id} expense={expense} onEdit={onEdit} onDelete={onDelete}/>)
        ) : (
          <Empty title="No personal expenses yet" detail="Add your first personal expense to start tracking your own spending."/>
        )}
      </section>
    </div>
  );
}
function PersonalExpenseModal({ expense, onClose, onSave }) {
  const [form, setForm] = useState(() => ({
    title: expense?.title || "",
    amount: expense ? String(expense.amount) : "",
    category: expense?.category || "Other",
    date: expense?.date || currentDate(),
    notes: expense?.notes || "",
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const update = (key, value) => { setError(""); setForm((current) => ({ ...current, [key]: value })); };

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    let prepared;
    try {
      prepared = validatePersonalExpense(form);
    } catch (validationError) {
      setError(validationError.message);
      return;
    }

    setBusy(true);

    try {
      await onSave(prepared);
    } catch (saveError) {
      setError(saveError?.message || "Could not save your personal expense.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={expense ? "Edit personal expense" : "Add personal expense"} subtitle="This expense stays private to your account — it is never shared with a group." onClose={onClose}>
      <form className="form-stack" onSubmit={handleSubmit}>
        <div className="form-two-col">
          <label>Expense name<input required autoFocus maxLength="200" placeholder="e.g. Lunch, new shoes" value={form.title} onChange={(event) => update("title", event.target.value)}/></label>
          <label>Amount (₹)<input required type="number" min="0.01" step="0.01" placeholder="0.00" value={form.amount} onChange={(event) => update("amount", event.target.value)}/></label>
          <label>Category<select value={form.category} onChange={(event) => update("category", event.target.value)}>{PERSONAL_EXPENSE_CATEGORIES.map((name) => <option key={name}>{name}</option>)}</select></label>
          <label>Date<input type="date" required value={form.date} onChange={(event) => update("date", event.target.value)}/></label>
        </div>
        <label>Notes <span className="muted-text">(optional)</span><textarea rows="2" placeholder="Add a note for yourself" value={form.notes} onChange={(event) => update("notes", event.target.value)}/></label>
        <div className="notice"><CircleHelp size={16}/> Personal expenses never affect a group's balances and are visible only to you.</div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>{busy ? "Saving..." : expense ? "Save changes" : "Add expense"}</Button>
        </div>
      </form>
    </Modal>
  );
}

createRoot(document.getElementById("root")).render(
  <AuthGate>
    <App />
  </AuthGate>
);
