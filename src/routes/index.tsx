import { createFileRoute } from "@tanstack/react-router";
import { VeilApp } from "@/components/veil/veil-app";

export const Route = createFileRoute("/")({
  component: VeilApp,
});
