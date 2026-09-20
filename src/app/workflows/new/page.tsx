import { Suspense } from "react";
import WorkflowEditor from "@/components/WorkflowEditor";

export default function NewWorkflowPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm text-outline">Loading editor...</div>}>
      <WorkflowEditor workflowId={null} />
    </Suspense>
  );
}
