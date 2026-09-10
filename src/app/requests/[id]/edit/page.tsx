"use client";

import { useParams } from "next/navigation";
import RequestForm from "@/components/RequestForm";

export default function EditRequestPage() {
  const params = useParams();
  const id = params.id as string;
  return <RequestForm templateId={null} editRequestId={id} />;
}
