"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import WorkflowEditor from "@/components/WorkflowEditor";

export default function EditWorkflowPage() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : (params.id as string);
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm text-outline">Loading editor...</div>}>
      <WorkflowEditor workflowId={id} />
    </Suspense>
  );
}
