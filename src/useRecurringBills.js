import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { mapRecurringBill, mapRecurringOccurrence } from "./recurringBills.js";

const billColumns =
  "id, group_id, created_by, title, amount, currency, category, notes, frequency, start_date, end_date, next_due_date, paid_by, split_type, participant_ids, split_values, status, created_at";
const occurrenceColumns =
  "id, recurring_bill_id, group_id, occurrence_date, expense_id, recorded_by, recorded_at";

export function useRecurringBills(authUser, groupId, enabled = true) {
  const [bills, setBills] = useState([]);
  const [occurrences, setOccurrences] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const refresh = useCallback(() => {
    setRefreshToken((value) => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!enabled || !authUser?.id || !groupId) {
      setBills([]);
      setOccurrences([]);
      setLoading(false);
      setError(null);
      return () => {
        cancelled = true;
      };
    }

    async function loadRecurring() {
      setLoading(true);
      setError(null);

      const [billResult, occurrenceResult] = await Promise.all([
        supabase
          .from("recurring_bills")
          .select(billColumns)
          .eq("group_id", groupId)
          .order("next_due_date", { ascending: true }),
        supabase
          .from("recurring_bill_occurrences")
          .select(occurrenceColumns)
          .eq("group_id", groupId)
          .order("occurrence_date", { ascending: false }),
      ]);

      if (cancelled) return;

      const queryError = billResult.error || occurrenceResult.error;

      if (queryError) {
        console.error("Recurring bill query failed:", queryError);
        setBills([]);
        setOccurrences([]);
        setError(queryError.message || "Could not load recurring bills.");
      } else {
        setBills((billResult.data || []).map(mapRecurringBill));
        setOccurrences((occurrenceResult.data || []).map(mapRecurringOccurrence));
      }

      setLoading(false);
    }

    void loadRecurring();

    return () => {
      cancelled = true;
    };
  }, [authUser?.id, groupId, enabled, refreshToken]);

  const createBill = useCallback(
    async (form) => {
      if (!authUser?.id) {
        throw new Error("Please sign in before creating a recurring bill.");
      }

      if (!groupId) {
        throw new Error("Select a group first.");
      }

      const amountPaise = Math.round(Number(form.amount) * 100);

      if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
        throw new Error("Enter a valid amount greater than zero.");
      }

      const { data, error: rpcError } = await supabase.rpc("create_recurring_bill", {
        p_group_id: groupId,
        p_title: form.title.trim(),
        p_amount_paise: amountPaise,
        p_category: form.category,
        p_frequency: form.frequency,
        p_start_date: form.startDate,
        p_end_date: form.endDate || null,
        p_paid_by: form.paidById,
        p_split_type: form.splitMethod,
        p_participant_ids: [...new Set(form.participantIds || [])],
        p_split_values: form.splitValues || {},
        p_notes: form.notes?.trim() || null,
      });

      if (rpcError) {
        throw new Error(rpcError.message || "Could not create the recurring bill.");
      }

      refresh();
      return data;
    },
    [authUser?.id, groupId, refresh]
  );

  const updateBill = useCallback(
    async (billId, form) => {
      if (!authUser?.id) {
        throw new Error("Please sign in before editing a recurring bill.");
      }

      if (!billId) {
        throw new Error("Select a recurring bill first.");
      }

      const amountPaise = Math.round(Number(form.amount) * 100);

      if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
        throw new Error("Enter a valid amount greater than zero.");
      }

      const { error: rpcError } = await supabase.rpc("update_recurring_bill", {
        p_bill_id: billId,
        p_title: form.title.trim(),
        p_amount_paise: amountPaise,
        p_category: form.category,
        p_frequency: form.frequency,
        p_start_date: form.startDate,
        p_end_date: form.endDate || null,
        p_paid_by: form.paidById,
        p_split_type: form.splitMethod,
        p_participant_ids: [...new Set(form.participantIds || [])],
        p_split_values: form.splitValues || {},
        p_notes: form.notes?.trim() || null,
      });

      if (rpcError) {
        throw new Error(rpcError.message || "Could not update the recurring bill.");
      }

      refresh();
    },
    [authUser?.id, refresh]
  );

  const setStatus = useCallback(
    async (billId, status) => {
      if (!authUser?.id) {
        throw new Error("Please sign in before changing a recurring bill.");
      }

      if (!billId) {
        throw new Error("Select a recurring bill first.");
      }

      const { error: rpcError } = await supabase.rpc("set_recurring_bill_status", {
        p_bill_id: billId,
        p_status: status,
      });

      if (rpcError) {
        throw new Error(rpcError.message || "Could not update the recurring bill.");
      }

      refresh();
    },
    [authUser?.id, refresh]
  );

  const recordPayment = useCallback(
    async ({ billId, occurrenceDate, shares }) => {
      if (!authUser?.id) {
        throw new Error("Please sign in before recording a payment.");
      }

      if (!billId || !occurrenceDate) {
        throw new Error("This recurring bill has no due date to record.");
      }

      const { data, error: rpcError } = await supabase.rpc("record_recurring_bill_payment", {
        p_bill_id: billId,
        p_occurrence_date: occurrenceDate,
        p_shares: shares,
      });

      if (rpcError) {
        throw new Error(rpcError.message || "Could not record this payment.");
      }

      refresh();
      return Array.isArray(data) ? data[0] : data;
    },
    [authUser?.id, refresh]
  );

  return {
    bills,
    occurrences,
    loading,
    error,
    refresh,
    createBill,
    updateBill,
    setStatus,
    recordPayment,
  };
}
