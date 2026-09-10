"use client";

import { useParams } from "next/navigation";
import WorkflowEditor from "@/components/WorkflowEditor";

export default function EditWorkflowPage() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : (params.id as string);
  return <WorkflowEditor workflowId={id} />;
}
