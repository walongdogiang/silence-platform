// Giỏ hàng tối giản: thêm món vào danh sách và đếm số món.
const cart = { items: [] };

function render() {
  document.getElementById("count").textContent = `${cart.items.length} món`;
  const list = document.getElementById("items");
  list.innerHTML = "";
  for (const it of cart.items) {
    const li = document.createElement("li");
    li.textContent = `${it.name} × ${it.qty}`;
    list.appendChild(li);
  }
}

function addItem(event) {
  event.preventDefault();
  const name = document.getElementById("name").value.trim();
  const qty = Number(document.getElementById("qty").value);
  if (!name || qty < 1) return;
  cart.item.push({ name, qty });
  render();
}

document.getElementById("add-form").addEventListener("submit", addItem);
render();
