type RootNavigator = Pick<Location, "replace">;

export async function verifyEmailCodeThenRestoreAccount(
  verifyCode: () => Promise<unknown>,
  navigator: RootNavigator = window.location,
) {
  await verifyCode();
  navigator.replace("/");
}
