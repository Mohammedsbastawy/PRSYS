"use client";

import { useParams } from "next/navigation";
import RequestForm from "@/components/RequestForm";

export default function DynamicRequestFormPage() {
  const params = useParams();
  const templateId = params.templateId as string;
  return <RequestForm templateId={templateId} editRequestId={null} />;
}
