"use client";

import { useParams } from "next/navigation";
import FormTemplateEditor from "@/components/FormTemplateEditor";

export default function EditFormTemplatePage() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : (params.id as string);
  return <FormTemplateEditor templateId={id} />;
}
