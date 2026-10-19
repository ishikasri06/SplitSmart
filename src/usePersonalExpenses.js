import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { mapPersonalExpenseRow, personalExpenseToRow } from "./personalExpenses.js";

const personalExpenseColumns =
  "id, user_id, title, amount, currency, category, expense_date, notes, created_at, updated_at";

export function usePersonalExpenses(authUser, enabled = true) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const refresh = useCallback(() => {
    setRefreshToken((value) => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!enabled || !authUser?.id) {
      setItems([]);
      setLoading(false);
      setError(null);
      return () => {
        cancelled = true;
      };
    }

    async function loadPersonalExpenses() {
      setLoading(true);
      setError(null);

      const { data, error: queryError } = await supabase
        .from("personal_expenses")
        .select(personalExpenseColumns)
        .eq("user_id", authUser.id)
        .order("expense_date", { ascending: false })
        .order("created_at", { ascending: false });

      if (cancelled) return;

      if (queryError) {
        setItems([]);
        setError(queryError.message || "Could not load your personal expenses.");
      } else {
        setItems((data || []).map(mapPersonalExpenseRow));
      }

      setLoading(false);
    }

    void loadPersonalExpenses();

    return () => {
      cancelled = true;
    };
  }, [authUser?.id, enabled, refreshToken]);

  const createExpense = useCallback(
    async (form) => {
      if (!authUser?.id) {
        throw new Error("Please sign in before adding a personal expense.");
      }

      const row = personalExpenseToRow(authUser.id, form);
      const { data, error: insertError } = await supabase
        .from("personal_expenses")
        .insert(row)
        .select(personalExpenseColumns)
        .single();

      if (insertError) {
        throw new Error(insertError.message || "Could not save your personal expense.");
      }

      refresh();
      return mapPersonalExpenseRow(data);
    },
    [authUser?.id, refresh]
  );

  const updateExpense = useCallback(
    async (expenseId, form) => {
      if (!authUser?.id) {
        throw new Error("Please sign in before editing a personal expense.");
      }

      if (!expenseId) {
        throw new Error("Select a personal expense to edit.");
      }

      const row = personalExpenseToRow(authUser.id, form);
      delete row.user_id;

      const { error: updateError } = await supabase
        .from("personal_expenses")
        .update(row)
        .eq("id", expenseId)
        .eq("user_id", authUser.id);

      if (updateError) {
        throw new Error(updateError.message || "Could not update your personal expense.");
      }

      refresh();
    },
    [authUser?.id, refresh]
  );

  const deleteExpense = useCallback(
    async (expenseId) => {
      if (!authUser?.id) {
        throw new Error("Please sign in before deleting a personal expense.");
      }

      if (!expenseId) {
        throw new Error("Select a personal expense to delete.");
      }

      const { error: deleteError } = await supabase
        .from("personal_expenses")
        .delete()
        .eq("id", expenseId)
        .eq("user_id", authUser.id);

      if (deleteError) {
        throw new Error(deleteError.message || "Could not delete your personal expense.");
      }

      refresh();
    },
    [authUser?.id, refresh]
  );

  return {
    expenses: items,
    loading,
    error,
    refresh,
    createExpense,
    updateExpense,
    deleteExpense,
  };
}
