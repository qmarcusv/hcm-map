/**********************************************************
 * Map editor — Combo B: GitHub Pages + Google Apps Script
 * - Lưu/đọc điểm trực tiếp vào Google Sheets (Apps Script)
 * - Không cần backend tự dựng
 **********************************************************/

// ==== 0) CẤU HÌNH API ====
// Thay bằng URL Web App sau khi Deploy (kết thúc bằng /exec)
const API_URL =
	"https://script.google.com/macros/s/AKfycbynu0eOjShXHLlXeVP6n-ivpNgr7588Q8877HJai_3h_WPm2npNsQpGpqcw5xjwJwse/exec";
// Tuỳ chọn: khoá đơn giản chống spam. Phải trùng với APP_KEY trong Apps Script.
const APP_KEY = "change-this-key";

// ==== 1) KHỞI TẠO MAP ====
const map = L.map("map").setView([10.7769, 106.7009], 11); // Trung tâm TP.HCM

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
	attribution: "© OpenStreetMap contributors",
}).addTo(map);

// Lưu trữ các marker tùy chỉnh
let customPlaces = [];
let districtLayer = null;

// ==== 2) TIỆN ÍCH GỌI API (tránh CORS preflight) ====
function showLoading(show) {
	const el = document.getElementById("loading");
	if (!el) return;
	el.classList.toggle("show", !!show);
}

async function apiGet() {
	const res = await fetch(API_URL);
	const json = await res.json();
	if (!json.ok) throw new Error(json.error || "API GET failed");
	return json.data;
}

async function apiPost(payload) {
	const res = await fetch(API_URL, {
		method: "POST",
		// Dùng Content-Type đơn giản để không tạo preflight
		headers: { "Content-Type": "text/plain;charset=utf-8" },
		body: JSON.stringify({ ...payload, appKey: APP_KEY }),
	});
	const json = await res.json();
	if (!json.ok) throw new Error(json.error || "API POST failed");
	return json;
}

// ==== 3) HIỂN THỊ QUẬN/HUYỆN TỪ GEOJSON ====
async function loadDistricts() {
	try {
		const response = await fetch("Ho_Chi_Minh_City.geojson");
		const data = await response.json();

		const districts = data.features.filter(
			(feature) =>
				feature.properties.admin_level === "6" ||
				feature.properties.boundary === "administrative"
		);

		districtLayer = L.geoJSON(districts, {
			style: {
				color: "#FF6600",
				weight: 2,
				fillOpacity: 0.1,
				fillColor: "#FFE4CC",
			},
			onEachFeature: function (feature, layer) {
				const name =
					feature.properties.name ||
					feature.properties["name:vi"] ||
					feature.properties.NAME_3 ||
					"Quận/Huyện";

				// Hiển thị tên quận/huyện ở trung tâm
				if (layer.getBounds) {
					const center = layer.getBounds().getCenter();
					L.marker(center, {
						icon: L.divIcon({
							className: "district-label",
							html: `<div style="font-size:11px;color:#000;font-weight:bold;text-shadow:1px 1px 1px white;">${name}</div>`,
							iconSize: [120, 25],
							iconAnchor: [60, 12],
						}),
						interactive: false,
					}).addTo(map);
				}

				// Tooltip khi hover
				layer.bindTooltip(name, {
					permanent: false,
					direction: "center",
					className: "district-tooltip",
				});
			},
		}).addTo(map);
	} catch (error) {
		console.error("Lỗi khi tải HCMC geojson, thử fallback:", error);
		try {
			const fallbackResponse = await fetch("districts.geojson");
			const fallbackData = await fallbackResponse.json();

			districtLayer = L.geoJSON(fallbackData, {
				style: {
					color: "#FF6600",
					weight: 2,
					fillOpacity: 0.1,
					fillColor: "#FFE4CC",
				},
				onEachFeature: function (feature, layer) {
					const name =
						feature.properties.NAME_3 ||
						feature.properties.name ||
						"Quận/Huyện";
					if (layer.getBounds) {
						const center = layer.getBounds().getCenter();
						L.marker(center, {
							icon: L.divIcon({
								className: "district-label",
								html: `<div style="font-size:11px;color:#000;font-weight:bold;text-shadow:1px 1px 1px white;">${name}</div>`,
								iconSize: [120, 25],
								iconAnchor: [60, 12],
							}),
							interactive: false,
						}).addTo(map);
					}
				},
			}).addTo(map);
		} catch (fallbackError) {
			console.error("Không thể tải fallback districts.geojson:", fallbackError);
		}
	}
}

// ==== 4) NẠP DỮ LIỆU TỪ GOOGLE SHEETS (Apps Script) ====
async function loadPlacesFromAPI() {
	showLoading(true);
	try {
		const data = await apiGet();
		customPlaces = Array.isArray(data) ? data : [];
		// Cache để offline/fallback
		localStorage.setItem("customPlaces", JSON.stringify(customPlaces));
		refreshMarkers();
	} catch (err) {
		console.warn("API GET thất bại, dùng localStorage:", err);
		const saved = localStorage.getItem("customPlaces");
		customPlaces = saved ? JSON.parse(saved) : [];
		refreshMarkers();
	} finally {
		showLoading(false);
	}
}

// ==== 5) MODAL FORM ====
function createModal() {
	const modalHTML = `
    <div id="placeModal" style="
      display: none;
      position: fixed;
      z-index: 2000;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0,0,0,0.5);
    ">
      <div style="
        background-color: white;
        margin: 10% auto;
        padding: 20px;
        border-radius: 8px;
        width: 400px;
        max-width: 90%;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      ">
        <h3 style="margin-top: 0; color: #333;">Thêm điểm mới</h3>

        <div style="margin-bottom: 15px;">
          <label style="display: block; margin-bottom: 5px; font-weight: bold;">Tên điểm:</label>
          <input type="text" id="placeName" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;" placeholder="Nhập tên điểm">
        </div>

        <div style="margin-bottom: 15px;">
          <label style="display: block; margin-bottom: 5px; font-weight: bold;">Địa chỉ (tùy chọn):</label>
          <input type="text" id="placeAddress" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;" placeholder="Nhập địa chỉ">
        </div>

        <div style="margin-bottom: 20px;">
          <label style="display: block; margin-bottom: 5px; font-weight: bold;">Màu sắc:</label>
          <div style="display: flex; gap: 10px; align-items: center;">
            <input type="color" id="placeColor" value="#ff6b6b" style="width: 50px; height: 35px; border: none; border-radius: 4px; cursor: pointer;">
            <span style="font-size: 12px; color: #666;">Chọn màu cho marker</span>
          </div>
        </div>

        <div style="text-align: right;">
          <button onclick="closeModal()" style="background: #6c757d; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; margin-right: 10px;">Hủy</button>
          <button onclick="savePlaceData()" style="background: #28a745; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer;">Lưu</button>
        </div>
      </div>
    </div>
  `;
	document.body.insertAdjacentHTML("beforeend", modalHTML);
}

// Biến trạng thái form
let tempLatLng = null;
let editingPlace = null; // sẽ giữ cả object {id, lat, lng, ...}

// Click trên bản đồ -> mở form thêm mới
map.on("click", function (e) {
	tempLatLng = e.latlng;
	editingPlace = null;

	// Reset form
	document.getElementById("placeName").value = "";
	document.getElementById("placeAddress").value = "";
	document.getElementById("placeColor").value = "#ff6b6b";
	document.querySelector("#placeModal h3").textContent = "Thêm điểm mới";

	document.getElementById("placeModal").style.display = "block";
});

// ==== 6) LƯU / CẬP NHẬT LÊN GOOGLE SHEETS ====
async function savePlaceData() {
	const name = document.getElementById("placeName").value.trim();
	const address = document.getElementById("placeAddress").value.trim();
	const color = document.getElementById("placeColor").value;

	if (!name) {
		alert("Vui lòng nhập tên điểm!");
		return;
	}
	if (!tempLatLng) {
		alert("Thiếu toạ độ!");
		return;
	}

	// Nếu đang sửa, lấy id sẵn có
	const existingId = editingPlace?.id || null;

	const placeData = {
		id: existingId,
		name,
		address,
		lat: tempLatLng.lat,
		lng: tempLatLng.lng,
		color,
		timestamp: new Date().toISOString(),
	};

	showLoading(true);
	try {
		if (placeData.id) {
			await apiPost({ action: "update", ...placeData });
			// Cập nhật trong mảng local
			const idx = customPlaces.findIndex((p) => p.id === placeData.id);
			if (idx !== -1) customPlaces[idx] = placeData;
		} else {
			const { data } = await apiPost({ action: "add", ...placeData });
			placeData.id = data.id;
			customPlaces.push(placeData);
		}

		localStorage.setItem("customPlaces", JSON.stringify(customPlaces));
		refreshMarkers();
		closeModal();
		alert("Đã lưu vào Google Sheets!");
	} catch (err) {
		console.error(err);
		alert("Lưu thất bại. Kiểm tra Console để biết chi tiết.");
	} finally {
		showLoading(false);
	}
}

// ==== 7) VẼ / LÀM MỚI MARKERS ====
function refreshMarkers() {
	// Xoá markers tuỳ chỉnh cũ
	map.eachLayer(function (layer) {
		if (
			layer instanceof L.Marker &&
			layer.options.icon &&
			layer.options.icon.options.className === "custom-marker"
		) {
			map.removeLayer(layer);
		}
	});

	// Vẽ lại
	customPlaces.forEach((place) => {
		const color = place.color || "#3388ff";
		const customIcon = L.divIcon({
			className: "custom-marker",
			html: `<div style="background-color: ${color}; width: 20px; height: 20px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);"></div>`,
			iconSize: [20, 20],
			iconAnchor: [10, 10],
		});

		L.marker([place.lat, place.lng], { icon: customIcon }).addTo(map)
			.bindPopup(`
        <div style="min-width: 200px;">
          <b>${place.name}</b><br>
          ${place.address || ""}
          <br><br>
          <button onclick="editPlace(${place.lat}, ${
			place.lng
		})" style="background: #007cba; color: white; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer;">Sửa</button>
          <button onclick="deletePlace(${place.lat}, ${
			place.lng
		})" style="background: #dc3545; color: white; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer; margin-left: 5px;">Xóa</button>
        </div>
      `);
	});
}

// ==== 8) SỬA / XOÁ ====
function editPlace(lat, lng) {
	const place = customPlaces.find(
		(p) => Math.abs(p.lat - lat) < 0.0001 && Math.abs(p.lng - lng) < 0.0001
	);
	if (!place) return;

	tempLatLng = { lat, lng };
	editingPlace = { ...place }; // giữ cả id

	document.getElementById("placeName").value = place.name || "";
	document.getElementById("placeAddress").value = place.address || "";
	document.getElementById("placeColor").value = place.color || "#ff6b6b";
	document.querySelector("#placeModal h3").textContent = "Sửa điểm";

	document.getElementById("placeModal").style.display = "block";
}

async function deletePlace(lat, lng) {
	if (!confirm("Bạn có chắc muốn xóa điểm này?")) return;

	const target = customPlaces.find(
		(p) => Math.abs(p.lat - lat) < 0.0001 && Math.abs(p.lng - lng) < 0.0001
	);
	if (!target?.id) {
		alert("Không tìm thấy ID của điểm để xoá.");
		return;
	}

	showLoading(true);
	try {
		await apiPost({ action: "delete", id: target.id });
		customPlaces = customPlaces.filter((p) => p.id !== target.id);
		localStorage.setItem("customPlaces", JSON.stringify(customPlaces));
		refreshMarkers();
		console.log("Đã xoá:", target.id);
	} catch (err) {
		console.error(err);
		alert("Xoá thất bại. Kiểm tra Console để biết chi tiết.");
	} finally {
		showLoading(false);
	}
}

// ==== 9) EXPORT JSON (backup nhanh) ====
function exportPlacesJSON() {
	const dataStr = JSON.stringify(customPlaces, null, 2);
	const dataUri =
		"data:application/json;charset=utf-8," + encodeURIComponent(dataStr);
	const exportFileDefaultName = "places.json";

	const linkElement = document.createElement("a");
	linkElement.setAttribute("href", dataUri);
	linkElement.setAttribute("download", exportFileDefaultName);
	linkElement.click();
}

function addExportButton() {
	const exportButton = document.createElement("button");
	exportButton.innerHTML = "Export places.json";
	exportButton.style.cssText = `
    position: fixed;
    top: 10px;
    right: 10px;
    z-index: 1000;
    background: #28a745;
    color: white;
    border: none;
    padding: 10px 15px;
    border-radius: 5px;
    cursor: pointer;
    font-size: 14px;
    box-shadow: 0 2px 5px rgba(0,0,0,0.3);
  `;
	exportButton.onclick = exportPlacesJSON;
	document.body.appendChild(exportButton);
}

// ==== 10) KHỞI TẠO ====
document.addEventListener("DOMContentLoaded", function () {
	// Cache cũ (fallback nếu API hỏng)
	const saved = localStorage.getItem("customPlaces");
	if (saved) {
		try {
			customPlaces = JSON.parse(saved);
		} catch {
			customPlaces = [];
		}
	}

	// Khởi tạo UI
	loadDistricts();
	createModal();
	addExportButton();

	// Đóng modal khi click outside
	document.getElementById("placeModal").addEventListener("click", function (e) {
		if (e.target.id === "placeModal") {
			closeModal();
		}
	});

	// Nạp dữ liệu từ Google Sheets
	loadPlacesFromAPI();
});

// ==== 11) HÀM GLOBAL (để popup gọi được) ====
function closeModal() {
	document.getElementById("placeModal").style.display = "none";
	tempLatLng = null;
	editingPlace = null;
}

window.editPlace = editPlace;
window.deletePlace = deletePlace;
window.closeModal = closeModal;
window.savePlaceData = savePlaceData;
