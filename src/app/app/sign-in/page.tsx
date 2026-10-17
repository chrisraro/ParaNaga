import type { Metadata } from "next";
import { PageFrame } from "@/ui/app-shell/page-frame";
import { SignInScreen } from "@/ui/auth/sign-in-screen";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Optional commuter sign in for ParaNaga.",
};

export default function SignInPage() {
  return (
    <PageFrame title="Sign in" back testId="sign-in-page">
      <SignInScreen />
    </PageFrame>
  );
}
