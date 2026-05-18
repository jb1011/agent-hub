ALTER TABLE "Job"
  ADD COLUMN "queue_deadline" TIMESTAMP(3),
  ADD COLUMN "final_refund_deadline" TIMESTAMP(3),
  ADD COLUMN "delivered_at" TIMESTAMP(3);

CREATE INDEX "Job_status_queue_deadline_idx" ON "Job"("status", "queue_deadline");
CREATE INDEX "Job_status_work_deadline_idx" ON "Job"("status", "work_deadline");
CREATE INDEX "Job_status_final_refund_deadline_idx" ON "Job"("status", "final_refund_deadline");
