
import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { mapCloudExpense } from "./cloudDashboard.js";
import { splitExpense } from "./utils";

export function useCloudExpenses(authUser, groupId, enabled = true) {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const refresh = useCallback(() => {
    setRefreshToken((value) => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!enabled || !authUser?.id || !groupId) {
      setExpenses([]);
      setLoading(false);
      setError(null);
      return () => {
        cancelled = true;
      };
    }

    async function loadExpenses() {
      setLoading(true);
      setError(null);

      const { data, error: queryError } = await supabase
        .from("expenses")
        .select(`
          id,
          group_id,
          created_by,
          paid_by,
          title,
          amount,
          currency,
          category,
          split_type,
          expense_date,
          notes,
          created_at,
          expense_shares (
            user_id,
            share_amount,
            share_percentage
          )
        `)
        .eq("group_id", groupId)
        .order("created_at", { ascending: false });

      if (cancelled) return;

      if (queryError) {
        console.error("Cloud expense query failed:", queryError);
        setExpenses([]);
        setError(queryError.message || "Could not load cloud expenses.");
      } else {
        setExpenses((data || []).map(mapCloudExpense));
      }
      setLoading(false);
    }

    void loadExpenses();

    return () => {
      cancelled = true;
    };
  }, [authUser?.id, groupId, enabled, refreshToken]);

  async function createExpense(form) {
    if (!authUser?.id) {
      throw new Error("Please sign in before adding an expense.");
    }

    if (!groupId) {
      throw new Error("Select a cloud group first.");
    }

    const amountPaise = Math.round(Number(form.amount) * 100);

    if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
      throw new Error("Enter a valid amount greater than zero.");
    }

    const participantIds = [...new Set(form.participantIds || [])];

    if (participantIds.length === 0) {
      throw new Error("Choose at least one participant.");
    }

    // splitExpense returns rupees, with paise-safe rounding.
    const shares = splitExpense(
      amountPaise / 100,
      participantIds,
      form.splitMethod,
      form.shareValues
    );

    const sharePayload = participantIds.map((userId) => {
      const sharePaise = Math.round(Number(shares[userId]) * 100);

      const share = {
        user_id: userId,
        share_paise: sharePaise,
      };

      if (form.splitMethod === "percentage") {
        share.share_percentage = Number(form.shareValues[userId]);
      }

      return share;
    });

    const { data, error: rpcError } = await supabase.rpc(
      "create_group_expense",
      {
        p_group_id: groupId,
        p_title: form.title.trim(),
        p_amount_paise: amountPaise,
        p_category: form.category,
        p_paid_by: form.paidById,
        p_expense_date: form.date,
        p_notes: form.notes?.trim() || null,
        p_split_type: form.splitMethod,
        p_shares: sharePayload,
      }
    );

    if (rpcError) {
      throw new Error(rpcError.message || "Could not save cloud expense.");
    }

    refresh();
    return data;
  }

  
async function updateExpense(expenseId, form) {
  if (!authUser?.id) {
    throw new Error("Please sign in before editing an expense.");
  }

  if (!groupId || !expenseId) {
    throw new Error("Select an expense from a cloud group first.");
  }

  const amountPaise = Math.round(Number(form.amount) * 100);

  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
    throw new Error("Enter a valid amount greater than zero.");
  }

  const participantIds = [...new Set(form.participantIds || [])];

  if (participantIds.length === 0) {
    throw new Error("Choose at least one participant.");
  }

  const shares = splitExpense(
    amountPaise / 100,
    participantIds,
    form.splitMethod,
    form.shareValues
  );

  const sharePayload = participantIds.map((userId) => {
    const sharePaise = Math.round(Number(shares[userId]) * 100);

    const share = {
      user_id: userId,
      share_paise: sharePaise,
    };

    if (form.splitMethod === "percentage") {
      share.share_percentage = Number(form.shareValues[userId]);
    }

    return share;
  });

  const { error: rpcError } = await supabase.rpc(
    "update_group_expense",
    {
      p_expense_id: expenseId,
      p_group_id: groupId,
      p_title: form.title.trim(),
      p_amount_paise: amountPaise,
      p_category: form.category,
      p_paid_by: form.paidById,
      p_expense_date: form.date,
      p_notes: form.notes?.trim() || null,
      p_split_type: form.splitMethod,
      p_shares: sharePayload,
    }
  );

  if (rpcError) {
    throw new Error(rpcError.message || "Could not update cloud expense.");
  }

  refresh();
}


async function deleteExpense(expenseId) {
  if (!authUser?.id) {
    throw new Error("Please sign in before deleting an expense.");
  }

  if (!groupId || !expenseId) {
    throw new Error("Select a cloud expense first.");
  }

  const { error: rpcError } = await supabase.rpc(
    "delete_group_expense",
    {
      p_expense_id: expenseId,
      p_group_id: groupId,
    }
  );

  if (rpcError) {
    throw new Error(rpcError.message || "Could not delete cloud expense.");
  }

  refresh();
}



  return {
    expenses,
    loading,
    error,
    createExpense,
    updateExpense,
    deleteExpense,
    refresh,
  };
}
