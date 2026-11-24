// Orders reach the network through fetch() in src/api, never here.
export async function total() {
  return (await fetch('/cart')).json();
}
