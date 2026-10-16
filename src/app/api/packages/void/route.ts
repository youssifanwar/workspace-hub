import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  auditLogs,
  customerMeetingRoomPackages,
  customerSubscriptions,
  expenses,
  meetingRoomPackageUsageLedger,
  subscriptionUsageLedger,
} from "@/db/schema";
import { canManage, getCurrentUser } from "@/lib/auth";
import { applyBalanceChange, BalanceError } from "@/lib/customer-balance";
import { getActiveShiftForUser } from "@/lib/shift";

export const dynamic = "force-dynamic";

class VoidError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Voids a package that was sold by mistake (wrong customer / wrong package)
 * and gives the money back:
 *
 *  - paid from the customer's balance  -> returned to that balance
 *  - paid cash / visa / instapay       -> recorded as a "Package refund"
 *    expense in the current shift, so the drawer and reports still add up
 *
 * Only packages with NO hours used can be voided. Managers/admins only.
 */
export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!canManage(user.role)) {
      return NextResponse.json(
        { error: "Only managers/admins can void a package." },
        { status: 403 },
      );
    }

    const shift = await getActiveShiftForUser(user.id);
    if (!shift) {
      return NextResponse.json(
        { error: "Open a shift before voiding a package." },
        { status: 400 },
      );
    }

    const body = (await req.json().catch(() => null)) as {
      kind?: unknown;
      purchaseId?: unknown;
      reason?: unknown;
    } | null;
    const kind = body?.kind;
    const purchaseId = Number(body?.purchaseId);
    const reason =
      typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : "";

    if (kind !== "desk" && kind !== "meeting") {
      return NextResponse.json({ error: "Invalid package type." }, { status: 400 });
    }
    if (!Number.isSafeInteger(purchaseId) || purchaseId <= 0) {
      return NextResponse.json({ error: "Invalid package id." }, { status: 400 });
    }
    if (!reason) {
      return NextResponse.json(
        { error: "Write the reason for voiding this package." },
        { status: 400 },
      );
    }

    const result = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`void-package-${kind}-${purchaseId}`}))`,
      );

      let customerId: number;
      let status: string;
      let paymentMethod: string;
      let price: number;
      let totalHours: number;
      let name: string;
      let soldInShiftId: number | null;

      if (kind === "desk") {
        const [row] = await tx
          .select()
          .from(customerSubscriptions)
          .where(eq(customerSubscriptions.id, purchaseId))
          .limit(1);
        if (!row) throw new VoidError("Package not found.", 404);
        customerId = row.customerId;
        status = String(row.status);
        paymentMethod = row.paymentMethod;
        price = Number(row.priceSnapshot);
        totalHours = Number(row.totalHoursSnapshot);
        name = row.packageNameSnapshot;
        soldInShiftId = row.shiftId;
      } else {
        const [row] = await tx
          .select()
          .from(customerMeetingRoomPackages)
          .where(eq(customerMeetingRoomPackages.id, purchaseId))
          .limit(1);
        if (!row) throw new VoidError("Package not found.", 404);
        customerId = row.customerId;
        status = String(row.status);
        paymentMethod = row.paymentMethod;
        price = Number(row.priceSnapshot);
        totalHours = Number(row.totalHoursSnapshot);
        name = row.packageNameSnapshot;
        soldInShiftId = row.shiftId;
      }

      if (status === "cancelled") {
        throw new VoidError("This package was already voided.", 409);
      }

      // Unused means the ledger balance still equals the purchased hours.
      const ledger = await tx.execute(
        kind === "desk"
          ? sql`SELECT COALESCE(SUM(hours_delta), 0) AS balance FROM subscription_usage_ledger WHERE subscription_id = ${purchaseId}`
          : sql`SELECT COALESCE(SUM(hours_delta), 0) AS balance FROM meeting_room_package_usage_ledger WHERE package_purchase_id = ${purchaseId}`,
      );
      const balanceHours = Number(
        (ledger as { rows?: Array<Record<string, unknown>> }).rows?.[0]?.balance ?? 0,
      );
      if (Math.abs(balanceHours - totalHours) > 0.001) {
        throw new VoidError(
          "Hours from this package were already used, so it can't be voided.",
          409,
        );
      }

      if (kind === "desk") {
        await tx
          .update(customerSubscriptions)
          .set({ status: "cancelled" })
          .where(eq(customerSubscriptions.id, purchaseId));
        await tx.insert(subscriptionUsageLedger).values({
          subscriptionId: purchaseId,
          userId: user.id,
          entryType: "reversal",
          hoursDelta: (-totalHours).toFixed(2),
          reason: `Voided: ${reason}`,
          idempotencyKey: `desk-package-void-${purchaseId}`,
        });
      } else {
        await tx
          .update(customerMeetingRoomPackages)
          .set({ status: "cancelled" })
          .where(eq(customerMeetingRoomPackages.id, purchaseId));
        await tx.insert(meetingRoomPackageUsageLedger).values({
          packagePurchaseId: purchaseId,
          userId: user.id,
          entryType: "reversal",
          hoursDelta: (-totalHours).toFixed(2),
          reason: `Voided: ${reason}`,
          idempotencyKey: `meeting-package-void-${purchaseId}`,
        });
      }

      let refund: "balance" | "expense" | "none" = "none";
      if (price > 0) {
        if (paymentMethod === "balance") {
          await applyBalanceChange(tx, {
            customerId,
            delta: price,
            type: "refund",
            shiftId: shift.id,
            userId: user.id,
            note: `Voided package "${name}": ${reason}`,
          });
          refund = "balance";
        } else if (
          paymentMethod === "cash" &&
          soldInShiftId !== shift.id
        ) {
          // Cash goes back out of TODAY's drawer. (If it was sold in this
          // same shift the sale simply disappears from the drawer total,
          // and card/instapay refunds never touch the drawer.)
          await tx.insert(expenses).values({
            shiftId: shift.id,
            userId: user.id,
            amount: price.toFixed(2),
            category: "Package refund",
            note: `Voided ${kind} package "${name}" (#${purchaseId}, paid by ${paymentMethod}): ${reason}`,
          });
          refund = "expense";
        } else {
          refund = "none";
        }
      }

      await tx.insert(auditLogs).values({
        userId: user.id,
        action: "package_voided",
        entityType: kind === "desk" ? "customer_subscription" : "meeting_room_package",
        entityId: purchaseId,
        details: { customerId, price, paymentMethod, refund, reason, shiftId: shift.id },
      });

      return { refund, price, paymentMethod };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof VoidError || error instanceof BalanceError) {
      return NextResponse.json(
        { error: error.message },
        { status: (error as { status: number }).status },
      );
    }
    console.error("Void package error:", error);
    return NextResponse.json({ error: "Could not void the package." }, { status: 500 });
  }
}
