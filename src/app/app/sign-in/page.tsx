import type { Metadata } from "next";
import { LocalizedPageFrame } from "@/ui/app-shell/localized-page-frame";
import { SignInScreen } from "@/ui/auth/sign-in-screen";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Optional commuter sign in for ParaNaga.",
};

export default function SignInPage() {
  return (
    <LocalizedPageFrame title="signIn" back testId="sign-in-page">
      <SignInScreen />
    </LocalizedPageFrame>
  );
}
