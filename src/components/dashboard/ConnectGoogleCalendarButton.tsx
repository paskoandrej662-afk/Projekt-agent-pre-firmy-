"use client";

import { Button } from "@/components/ui/Button";

// White-label: the barber just clicks and logs in with Google. Navigating to the
// connect route bounces them through Google's consent screen and back.
export function ConnectGoogleCalendarButton() {
  return (
    <Button onClick={() => (window.location.href = "/api/google/connect")}>
      Pripojiť Google Kalendár
    </Button>
  );
}
