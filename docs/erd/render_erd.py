#!/usr/bin/env python3
"""Render a professional ERD PNG for PRSYS from the schema definition below."""
from PIL import Image, ImageDraw, ImageFont

# ---------------- Fonts ----------------
FB = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FR = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FM = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"

def font(path, size):
    return ImageFont.truetype(path, size)

F_TITLE = font(FB, 60)
F_SUB = font(FR, 30)
F_PANEL = font(FB, 26)
F_TNAME = font(FB, 28)
F_COL = font(FR, 25)
F_TYPE = font(FM, 23)
F_PILL = font(FB, 19)
F_LEG = font(FR, 24)
F_LEGB = font(FB, 24)
F_FOOT = font(FR, 22)

# ---------------- Colors ----------------
BG = "#FFFFFF"
TITLE_BG = "#0F172A"
TITLE_FG = "#FFFFFF"
TITLE_SUB = "#94A3B8"
PANEL_FILL = "#F6F8FB"
PANEL_BORDER = "#E2E8F0"
PANEL_LABEL = "#475569"
BOX_BORDER_W = 3
ROW_ALT = "#F1F5F9"
COL_NAME = "#0F172A"
COL_TYPE = "#64748B"
LINE = "#5B6B82"
LINE_W = 3
LOGICAL = "#94A3B8"

MODULES = {
    "identity": ("#2563EB", "Identity & Organization"),
    "forms": ("#7C3AED", "Form Builder"),
    "workflow": ("#EA580C", "Workflow Engine"),
    "requests": ("#0D9488", "Requests Core"),
    "catalog": ("#0284C7", "Item Catalog"),
    "support": ("#64748B", "Support"),
}

# ---------------- Schema: (table, module, [(col, type, keys)]) ----------------
# keys: PK / FK / UK
T = lambda name, module, cols: {"name": name, "module": module, "cols": cols}

TABLES = [
    T("Roles", "identity", [
        ("RoleID", "uuid", "PK"), ("Name", "varchar", ""), ("Code", "varchar", "UK"),
        ("Description", "varchar", ""), ("IsSystemDefault", "bool", ""),
        ("CreatedAt", "datetime", ""), ("UpdatedAt", "datetime", "")]),
    T("Permissions", "identity", [
        ("PermissionID", "uuid", "PK"), ("Code", "varchar", "UK"), ("Module", "varchar", ""),
        ("Name", "varchar", ""), ("Description", "varchar", ""), ("CreatedAt", "datetime", "")]),
    T("RolePermissions", "identity", [
        ("RoleID", "uuid", "PK FK"), ("PermissionID", "uuid", "PK FK"), ("GrantedAt", "datetime", "")]),
    T("DEP", "identity", [
        ("DEPID", "uuid", "PK"), ("Name", "varchar", ""), ("Code", "varchar", "UK"),
        ("ManagerID", "uuid", "UK FK"), ("CreatedAt", "datetime", ""), ("UpdatedAt", "datetime", "")]),
    T("Groups", "identity", [
        ("GroupID", "uuid", "PK"), ("Name", "varchar", ""), ("Description", "varchar", ""),
        ("CreatedAt", "datetime", ""), ("UpdatedAt", "datetime", "")]),
    T("GroupMembers", "identity", [
        ("GroupID", "uuid", "PK FK"), ("UserID", "uuid", "PK FK"), ("AddedAt", "datetime", "")]),
    T("Users", "identity", [
        ("UserID", "uuid", "PK"), ("Name", "varchar", ""), ("Email", "varchar", "UK"),
        ("PasswordHash", "varchar", ""), ("AccountType", "varchar", ""), ("RoleID", "uuid", "FK"),
        ("DEPID", "uuid", "FK"), ("DirectManagerID", "uuid", "FK"), ("IsActive", "bool", ""),
        ("CreatedAt", "datetime", ""), ("UpdatedAt", "datetime", "")]),
    T("FormCategories", "forms", [
        ("FormCategoryID", "uuid", "PK"), ("Name", "varchar", ""), ("SortOrder", "int", ""),
        ("CreatedAt", "datetime", ""), ("UpdatedAt", "datetime", "")]),
    T("FormTemplates", "forms", [
        ("FormTemplateID", "uuid", "PK"), ("Name", "varchar", ""), ("Description", "varchar", ""),
        ("FormCategoryID", "uuid", "FK"), ("WFDefinitionID", "uuid", "FK"), ("Status", "varchar", ""),
        ("Version", "int", ""), ("CreatedAt", "datetime", ""), ("UpdatedAt", "datetime", "")]),
    T("FormFields", "forms", [
        ("FormFieldID", "uuid", "PK"), ("FormTemplateID", "uuid", "FK"), ("Label", "varchar", ""),
        ("FieldKey", "varchar", ""), ("FieldType", "varchar", ""), ("IsRequired", "bool", ""),
        ("SortOrder", "int", ""), ("Config", "varchar", ""), ("CreatedAt", "datetime", ""),
        ("UpdatedAt", "datetime", "")]),
    T("FormPermissions", "forms", [
        ("FormPermissionID", "uuid", "PK"), ("FormTemplateID", "uuid", "FK"),
        ("PermissionType", "varchar", ""), ("DEPID", "uuid", "FK"), ("GroupID", "uuid", "FK"),
        ("UserID", "uuid", "FK"), ("CreatedAt", "datetime", "")]),
    T("WFDefinitions", "workflow", [
        ("WFDefinitionID", "uuid", "PK"), ("Name", "varchar", ""), ("Description", "varchar", ""),
        ("Status", "varchar", ""), ("CreatedAt", "datetime", ""), ("UpdatedAt", "datetime", "")]),
    T("WFSteps", "workflow", [
        ("WFStepID", "uuid", "PK"), ("WFDefinitionID", "uuid", "FK"), ("StepName", "varchar", ""),
        ("StepOrder", "int", ""), ("ApproverType", "varchar", ""), ("TargetUserID", "uuid", "FK"),
        ("TargetGroupID", "uuid", "FK"), ("TargetRoleID", "uuid", "FK"), ("ApprovalMode", "varchar", ""),
        ("RejectAction", "varchar", ""), ("Condition", "varchar", ""), ("CreatedAt", "datetime", ""),
        ("UpdatedAt", "datetime", "")]),
    T("Requests", "requests", [
        ("RequestID", "uuid", "PK"), ("TrackingNumber", "varchar", "UK"),
        ("FormTemplateID", "uuid", "FK"), ("RequesterID", "uuid", "FK"), ("Status", "varchar", ""),
        ("CurrentWFStepID", "uuid", "FK"), ("FormSnapshot", "text", ""), ("Priority", "varchar", ""),
        ("AssigneeID", "uuid", "FK"), ("FulfillmentType", "varchar", ""), ("StockIssueNumber", "varchar", ""),
        ("OraclePoNumber", "varchar", ""), ("PoCreatedByUserID", "uuid", "FK"),
        ("PoCreatedAt", "datetime", ""), ("PoNotes", "varchar", ""), ("SubmittedAt", "datetime", ""),
        ("CompletedAt", "datetime", ""), ("CreatedAt", "datetime", ""), ("UpdatedAt", "datetime", "")]),
    T("RequestFieldValues", "requests", [
        ("RequestFieldValueID", "uuid", "PK"), ("RequestID", "uuid", "FK"), ("FormFieldID", "uuid", "FK"),
        ("Value", "varchar", ""), ("CreatedAt", "datetime", ""), ("UpdatedAt", "datetime", "")]),
    T("RequestItems", "requests", [
        ("RequestItemID", "uuid", "PK"), ("RequestID", "uuid", "FK"), ("FormFieldID", "uuid", "FK"),
        ("RequestedItemName", "varchar", ""), ("RequestedItemDetails", "varchar", ""),
        ("RequestedUom", "varchar", ""), ("RequestedQuantity", "decimal", ""),
        ("ItemCatalogCacheID", "uuid", "FK"), ("OracleItemID", "varchar", ""), ("ItemCode", "varchar", ""),
        ("ItemName", "varchar", ""), ("Uom", "varchar", ""), ("OrganizationCode", "varchar", ""),
        ("OnHandQuantity", "decimal", ""), ("ItemVerifiedByUserID", "uuid", "FK"),
        ("ItemVerifiedAt", "datetime", ""), ("IssuedFromStockQuantity", "decimal", ""),
        ("ToPurchaseQuantity", "decimal", ""), ("EstimatedPrice", "decimal", ""),
        ("StockDecisionNotes", "varchar", ""), ("CreatedAt", "datetime", ""), ("UpdatedAt", "datetime", "")]),
    T("RequestApprovals", "requests", [
        ("RequestApprovalID", "uuid", "PK"), ("RequestID", "uuid", "FK"), ("WFStepID", "uuid", "FK"),
        ("ApproverUserID", "uuid", "FK"), ("Decision", "varchar", ""), ("Comment", "varchar", ""),
        ("DecidedAt", "datetime", ""), ("CreatedAt", "datetime", "")]),
    T("RequestComments", "requests", [
        ("RequestCommentID", "uuid", "PK"), ("RequestID", "uuid", "FK"), ("AuthorUserID", "uuid", "FK"),
        ("CommentText", "varchar", ""), ("CommentType", "varchar", ""), ("IsInternal", "bool", ""),
        ("CreatedAt", "datetime", ""), ("UpdatedAt", "datetime", "")]),
    T("RequestAttachments", "requests", [
        ("RequestAttachmentID", "uuid", "PK"), ("RequestID", "uuid", "FK"), ("UploadedByUserID", "uuid", "FK"),
        ("FileName", "varchar", ""), ("FilePath", "varchar", ""), ("MimeType", "varchar", ""),
        ("FileSize", "bigint", ""), ("CreatedAt", "datetime", "")]),
    T("ItemCatalogCache", "catalog", [
        ("ItemCatalogCacheID", "uuid", "PK"), ("OracleItemID", "varchar", "UK"),
        ("ItemCode", "varchar", "UK"), ("ItemName", "varchar", ""), ("Description", "varchar", ""),
        ("Uom", "varchar", ""), ("OrganizationCode", "varchar", ""), ("LastPurchasedPrice", "decimal", ""),
        ("FirstUsedAt", "datetime", ""), ("LastUsedAt", "datetime", "")]),
    T("Notifications", "support", [
        ("NotificationID", "uuid", "PK"), ("UserID", "uuid", "FK"), ("Title", "varchar", ""),
        ("Message", "varchar", ""), ("Type", "varchar", ""), ("RelatedRequestID", "uuid", "FK"),
        ("IsRead", "bool", ""), ("CreatedAt", "datetime", "")]),
    T("RequestAuditLog", "support", [
        ("AuditLogID", "uuid", "PK"), ("RequestID", "uuid", "FK"), ("ChangedByUserID", "uuid", "FK"),
        ("FromStatus", "varchar", ""), ("ToStatus", "varchar", ""), ("Action", "varchar", ""),
        ("Note", "varchar", ""), ("CreatedAt", "datetime", "")]),
]

BY_NAME = {t["name"]: t for t in TABLES}

# ---------------- Layout: columns of tables ----------------
COLUMNS = [
    ("Identity & Organization", ["Roles", "Permissions", "RolePermissions", "DEP", "Groups", "GroupMembers"]),
    ("Users — Central Hub", ["Users"]),
    ("Forms & Workflow", ["FormCategories", "FormTemplates", "FormFields", "FormPermissions", "WFDefinitions", "WFSteps"]),
    ("Requests Core", ["Requests", "ItemCatalogCache", "Notifications", "RequestAuditLog"]),
    ("Request Details", ["RequestFieldValues", "RequestItems", "RequestApprovals", "RequestComments", "RequestAttachments"]),
]

# (child_table, child_fk_col, parent_table, kind)  kind: rel | one2one | logical | self
RELS = [
    ("RolePermissions", "RoleID", "Roles", "rel"),
    ("RolePermissions", "PermissionID", "Permissions", "rel"),
    ("Users", "RoleID", "Roles", "rel"),
    ("Users", "DirectManagerID", "Users", "self"),
    ("DEP", "ManagerID", "Users", "one2one"),
    ("Users", "DEPID", "DEP", "logical"),
    ("GroupMembers", "GroupID", "Groups", "rel"),
    ("GroupMembers", "UserID", "Users", "rel"),
    ("FormTemplates", "FormCategoryID", "FormCategories", "rel"),
    ("FormTemplates", "WFDefinitionID", "WFDefinitions", "rel"),
    ("FormFields", "FormTemplateID", "FormTemplates", "rel"),
    ("FormPermissions", "FormTemplateID", "FormTemplates", "rel"),
    ("FormPermissions", "DEPID", "DEP", "rel"),
    ("FormPermissions", "GroupID", "Groups", "rel"),
    ("FormPermissions", "UserID", "Users", "rel"),
    ("WFSteps", "WFDefinitionID", "WFDefinitions", "rel"),
    ("WFSteps", "TargetUserID", "Users", "rel"),
    ("WFSteps", "TargetGroupID", "Groups", "rel"),
    ("WFSteps", "TargetRoleID", "Roles", "rel"),
    ("Requests", "FormTemplateID", "FormTemplates", "rel"),
    ("Requests", "RequesterID", "Users", "rel"),
    ("Requests", "AssigneeID", "Users", "rel"),
    ("Requests", "PoCreatedByUserID", "Users", "rel"),
    ("Requests", "CurrentWFStepID", "WFSteps", "rel"),
    ("RequestFieldValues", "RequestID", "Requests", "rel"),
    ("RequestFieldValues", "FormFieldID", "FormFields", "rel"),
    ("RequestItems", "RequestID", "Requests", "rel"),
    ("RequestItems", "FormFieldID", "FormFields", "rel"),
    ("RequestItems", "ItemCatalogCacheID", "ItemCatalogCache", "rel"),
    ("RequestItems", "ItemVerifiedByUserID", "Users", "rel"),
    ("RequestApprovals", "RequestID", "Requests", "rel"),
    ("RequestApprovals", "WFStepID", "WFSteps", "rel"),
    ("RequestApprovals", "ApproverUserID", "Users", "rel"),
    ("RequestComments", "RequestID", "Requests", "rel"),
    ("RequestComments", "AuthorUserID", "Users", "rel"),
    ("RequestAttachments", "RequestID", "Requests", "rel"),
    ("RequestAttachments", "UploadedByUserID", "Users", "rel"),
    ("Notifications", "UserID", "Users", "rel"),
    ("Notifications", "RelatedRequestID", "Requests", "rel"),
    ("RequestAuditLog", "RequestID", "Requests", "rel"),
    ("RequestAuditLog", "ChangedByUserID", "Users", "rel"),
]

# ---------------- Metrics ----------------
ROW_H = 36
HDR_H = 54
BOX_PAD = 14
TABLE_GAP = 34
PANEL_PAD = 26
PANEL_LABEL_H = 52
PANEL_GAP = 175
MARGIN = 48
TITLE_H = 175
LEGEND_H = 128
FOOTER_H = 64
BUS_LANE = 21

tmp_img = Image.new("RGB", (10, 10))
tmp_d = ImageDraw.Draw(tmp_img)

def tw(text, f):
    b = tmp_d.textbbox((0, 0), text, font=f)
    return b[2] - b[0]

PILL_W = {"PK": tw("PK", F_PILL) + 20, "FK": tw("FK", F_PILL) + 20, "UK": tw("UK", F_PILL) + 20}

def pills_width(keys):
    ks = keys.split()
    if not ks:
        return 0
    return sum(PILL_W[k] for k in ks) + 8 * (len(ks) - 1)

def table_width(t):
    w = tw(t["name"], F_TNAME) + 60
    for (c, typ, keys) in t["cols"]:
        pw = pills_width(keys)
        cw = tw(c, F_COL) + tw(typ, F_TYPE) + 60 + (pw + 14 if pw else 0)
        w = max(w, cw)
    return w + BOX_PAD * 2

def table_height(t):
    return HDR_H + ROW_H * len(t["cols"])

COL_W = []
for (_, names) in COLUMNS:
    COL_W.append(max(table_width(BY_NAME[n]) for n in names))

COL_H = []
for (_, names) in COLUMNS:
    h = sum(table_height(BY_NAME[n]) for n in names) + TABLE_GAP * (len(names) - 1)
    COL_H.append(h)
MAX_COL_H = max(COL_H)

# bus lanes needed
COL_INDEX = {}
for ci, (_, names) in enumerate(COLUMNS):
    for n in names:
        COL_INDEX[n] = ci

def needs_bus(child, parent):
    return abs(COL_INDEX[child] - COL_INDEX[parent]) > 1

BUS_RELS = [r for r in RELS if r[3] != "self" and needs_bus(r[0], r[2])]
BUS_H = len(BUS_RELS) * BUS_LANE + 90

PANELS_Y = TITLE_H + LEGEND_H + 8
PANELS_H = PANEL_LABEL_H + MAX_COL_H + PANEL_PAD
CANVAS_W = MARGIN * 2 + sum(COL_W) + (len(COLUMNS) - 1) * PANEL_GAP + PANEL_PAD * 2 * len(COLUMNS)
CANVAS_H = PANELS_Y + PANELS_H + BUS_H + FOOTER_H + MARGIN

# ---------------- Geometry ----------------
class Box:
    def __init__(self, name, x, y, w):
        self.name = name
        self.x, self.y, self.w = x, y, w
        self.h = table_height(BY_NAME[name])
        self.left = x
        self.right = x + w
        self.top = y
        self.bottom = y + self.h
        self.cx = x + w / 2
        self.col = COL_INDEX[name]

    def row_y(self, idx):
        return self.y + HDR_H + idx * ROW_H + ROW_H / 2

BOXES = {}
panel_x = MARGIN
PANEL_XS = []
for ci, (label, names) in enumerate(COLUMNS):
    PANEL_XS.append(panel_x)
    bx = panel_x + PANEL_PAD
    by = PANELS_Y + PANEL_LABEL_H
    for n in names:
        BOXES[n] = Box(n, bx, by, COL_W[ci])
        by += BOXES[n].h + TABLE_GAP
    panel_w = COL_W[ci] + PANEL_PAD * 2
    panel_x += panel_w + PANEL_GAP

def col_of(name):
    return COL_INDEX[name]

def panel_right(ci):
    return PANEL_XS[ci] + COL_W[ci] + PANEL_PAD * 2

# ---------------- Draw ----------------
img = Image.new("RGB", (CANVAS_W, CANVAS_H), BG)
d = ImageDraw.Draw(img)

# Title band
d.rectangle([0, 0, CANVAS_W, TITLE_H], fill=TITLE_BG)
d.text((MARGIN, 28), "PRSYS  —  Procurement Request System", font=F_TITLE, fill=TITLE_FG)
d.text((MARGIN, 105), "Entity Relationship Diagram  ·  MySQL 8  ·  Prisma  ·  22 Tables  ·  41 Relationships",
       font=F_SUB, fill=TITLE_SUB)
stats = "PK  FK  UK  ·  Crow's Foot Notation"
d.text((CANVAS_W - MARGIN - tw(stats, F_SUB), 105), stats, font=F_SUB, fill="#38BDF8")

# Legend strip
ly = TITLE_H + 26
lx = MARGIN

def legend_pill(x, y, text, fill, fg, border=None):
    w = tw(text, F_PILL) + 22
    d.rounded_rectangle([x, y, x + w, y + 30], radius=15, fill=fill, outline=border, width=2)
    d.text((x + 11, y + 3), text, font=F_PILL, fill=fg)
    return w

lx0 = lx
w = legend_pill(lx, ly, "PK", "#1E293B", "#FFFFFF"); lx += w + 10
d.text((lx, ly + 1), "= Primary Key", font=F_LEG, fill="#334155"); lx += tw("= Primary Key", F_LEG) + 36
w = legend_pill(lx, ly, "FK", "#FFFFFF", "#334155", "#64748B"); lx += w + 10
d.text((lx, ly + 1), "= Foreign Key", font=F_LEG, fill="#334155"); lx += tw("= Foreign Key", F_LEG) + 36
w = legend_pill(lx, ly, "UK", "#FEF3C2", "#92400E"); lx += w + 10
d.text((lx, ly + 1), "= Unique", font=F_LEG, fill="#334155"); lx += tw("= Unique", F_LEG) + 44

# line notation samples
def sample_crowsfoot(x, y, w=150):
    d.line([x, y + 15, x + w, y + 15], fill=LINE, width=LINE_W)
    # one tick at left
    d.line([x + 8, y + 4, x + 8, y + 26], fill=LINE, width=LINE_W)
    # crow's foot at right
    ax = x + w - 26
    d.line([ax, y + 15, x + w - 2, y + 4], fill=LINE, width=LINE_W)
    d.line([ax, y + 15, x + w - 2, y + 26], fill=LINE, width=LINE_W)
    d.line([ax, y + 15, x + w - 2, y + 15], fill=LINE, width=LINE_W)

sample_crowsfoot(lx, ly); lx += 162
d.text((lx, ly + 1), "= One-to-Many", font=F_LEG, fill="#334155"); lx += tw("= One-to-Many", F_LEG) + 44
# dashed sample
for sx in range(0, 120, 18):
    d.line([lx + sx, ly + 15, lx + sx + 10, ly + 15], fill=LOGICAL, width=LINE_W)
lx += 132
d.text((lx, ly + 1), "= Logical ref.", font=F_LEG, fill="#334155")
# module chips (right side, second row handled if overflow)
ly2 = ly + 48
lx = MARGIN
for key, (color, label) in MODULES.items():
    d.rounded_rectangle([lx, ly2, lx + 26, ly2 + 26], radius=6, fill=color)
    lx += 32
    d.text((lx, ly2 - 1), label, font=F_LEG, fill="#334155")
    lx += tw(label, F_LEG) + 34

# Panels
for ci, (label, names) in enumerate(COLUMNS):
    px = PANEL_XS[ci]
    pw = COL_W[ci] + PANEL_PAD * 2
    d.rounded_rectangle([px, PANELS_Y, px + pw, PANELS_Y + PANELS_H], radius=18,
                        fill=PANEL_FILL, outline=PANEL_BORDER, width=2)
    d.text((px + PANEL_PAD, PANELS_Y + 12), label.upper(), font=F_PANEL, fill=PANEL_LABEL)

# Boxes
def draw_pill(x, y, text):
    w = PILL_W[text]
    if text == "PK":
        d.rounded_rectangle([x, y, x + w, y + 27], radius=13, fill="#1E293B")
        d.text((x + 10, y + 2), text, font=F_PILL, fill="#FFFFFF")
    elif text == "FK":
        d.rounded_rectangle([x, y, x + w, y + 27], radius=13, fill="#FFFFFF", outline="#64748B", width=2)
        d.text((x + 10, y + 2), text, font=F_PILL, fill="#334155")
    else:  # UK
        d.rounded_rectangle([x, y, x + w, y + 27], radius=13, fill="#FEF3C2")
        d.text((x + 10, y + 2), text, font=F_PILL, fill="#92400E")
    return w

for ci, (label, names) in enumerate(COLUMNS):
    for n in names:
        b = BOXES[n]
        t = BY_NAME[n]
        color = MODULES[t["module"]][0]
        # body
        d.rounded_rectangle([b.left, b.top, b.right, b.bottom], radius=12, fill="#FFFFFF")
        # rows
        for i, (c, typ, keys) in enumerate(t["cols"]):
            ry = b.top + HDR_H + i * ROW_H
            if i % 2 == 1:
                d.rectangle([b.left + 3, ry, b.right - 3, ry + ROW_H], fill=ROW_ALT)
            cx = b.left + BOX_PAD
            ks = keys.split()
            for k in ks:
                draw_pill(cx, ry + 5, k)
                cx += PILL_W[k] + 8
            if ks:
                cx += 6
            d.text((cx, ry + 4), c, font=F_COL, fill=COL_NAME)
            tx = b.right - BOX_PAD - tw(typ, F_TYPE)
            d.text((tx, ry + 5), typ, font=F_TYPE, fill=COL_TYPE)
        # header
        d.rounded_rectangle([b.left, b.top, b.right, b.top + HDR_H], radius=12, fill=color)
        d.rectangle([b.left, b.top + HDR_H - 12, b.right, b.top + HDR_H], fill=color)
        d.text((b.left + 18, b.top + 12), n, font=F_TNAME, fill="#FFFFFF")
        cnt = f"{len(t['cols'])} cols"
        d.text((b.right - 18 - tw(cnt, F_TYPE), b.top + 16), cnt, font=F_TYPE, fill="#E2E8F0")
        # border
        d.rounded_rectangle([b.left, b.top, b.right, b.bottom], radius=12, outline=color, width=BOX_BORDER_W)

# ---------------- Relationships ----------------
def draw_poly(points, color=LINE, width=LINE_W, dashed=False):
    if not dashed:
        d.line(points, fill=color, width=width, joint="curve")
    else:
        for a, b in zip(points, points[1:]):
            x0, y0 = a; x1, y1 = b
            seg_len = abs(x1 - x0) + abs(y1 - y0)
            n = max(1, int(seg_len / 16))
            for i in range(n):
                t0 = i / n; t1 = (i + 0.55) / n
                d.line([x0 + (x1 - x0) * t0, y0 + (y1 - y0) * t0,
                        x0 + (x1 - x0) * t1, y0 + (y1 - y0) * t1], fill=color, width=width)

def unit(vx, vy):
    import math
    m = math.hypot(vx, vy) or 1
    return vx / m, vy / m

def draw_crowsfoot(edge_pt, nxt_pt, color=LINE):
    ex, ey = edge_pt; nx, ny = nxt_pt
    dx, dy = unit(nx - ex, ny - ey)
    px, py = -dy, dx
    ax, ay = ex + dx * 26, ey + dy * 26
    t1 = (ex + dx * 3 + px * 11, ey + dy * 3 + py * 11)
    t2 = (ex + dx * 3 - px * 11, ey + dy * 3 - py * 11)
    tm = (ex + dx * 3, ey + dy * 3)
    d.line([(ax, ay), t1], fill=color, width=LINE_W)
    d.line([(ax, ay), t2], fill=color, width=LINE_W)
    d.line([(ax, ay), tm], fill=color, width=LINE_W)
    return (ax, ay)

def draw_one_tick(edge_pt, prev_pt, color=LINE, double=False):
    ex, ey = edge_pt; px0, py0 = prev_pt
    dx, dy = unit(ex - px0, ey - py0)
    nx, ny = -dy, dx
    for off in ([4, 15] if double else [5]):
        cx, cy = ex - dx * off, ey - dy * off
        d.line([(cx - nx * 11, cy - ny * 11), (cx + nx * 11, cy + ny * 11)], fill=color, width=LINE_W)

def fk_index(table, col):
    for i, (c, _, _) in enumerate(BY_NAME[table]["cols"]):
        if c == col:
            return i
    return 0

same_col_lane = {}
# Explicit bus-entry styles: bottom edge vs side edge via panel padding / gap risers
# (avoids risers crossing boxes stacked below the parent in the same column)
BUS_ENTRY = {
    ("FormPermissions", "DEPID", "DEP"): ("pad", "left"),
    ("FormPermissions", "GroupID", "Groups"): ("pad", "left"),
    ("WFSteps", "TargetGroupID", "Groups"): ("gapleft",),
    ("WFSteps", "TargetRoleID", "Roles"): ("pad", "left"),
    ("RequestFieldValues", "FormFieldID", "FormFields"): ("pad", "left"),
    ("RequestItems", "FormFieldID", "FormFields"): ("pad", "right"),
}
BUS_CNT = {}
for r in BUS_RELS:
    BUS_CNT[r[2]] = BUS_CNT.get(r[2], 0) + 1
BUS_SLOT = {}
PAD_LANE = {}
BUS_TOP = PANELS_Y + PANELS_H + 46

def pad_x(pi, side):
    k = PAD_LANE.get((pi, side), 0)
    PAD_LANE[(pi, side)] = k + 1
    if side == "left":
        return PANEL_XS[pi] + 9 + k * 7
    return panel_right(pi) - 9 - k * 7

for ri, (child, fkcol, parent, kind) in enumerate(RELS):
    cb, pb = BOXES[child], BOXES[parent]
    y1 = cb.row_y(fk_index(child, fkcol))
    y2 = pb.row_y(0)
    color = LOGICAL if kind == "logical" else LINE
    dashed = (kind == "logical")

    if kind == "self":
        x = cb.right
        p0 = (x, y1); p3 = (x, y2)
        pts = [p0, (x + 62, y1), (x + 62, y2), p3]
        apex = draw_crowsfoot(p0, pts[1], color)
        draw_poly([apex, pts[1], pts[2], p3], color)
        draw_one_tick(p3, pts[2], color)
        continue

    if cb.col == pb.col:
        # same-column side channel (right side of panel)
        key = cb.col
        lane = same_col_lane.get(key, 0)
        same_col_lane[key] = lane + 1
        chx = panel_right(cb.col) + 30 + lane * 24
        p0 = (cb.right, y1); p3 = (pb.right, y2)
        pts = [p0, (chx, y1), (chx, y2), p3]
        apex = draw_crowsfoot(p0, pts[1], color)
        draw_poly([apex, pts[1], pts[2], p3], color, dashed=dashed)
        draw_one_tick(p3, pts[2], color, double=(kind == "one2one"))
        continue

    if needs_bus(child, parent):
        bi = next(i for i, r in enumerate(BUS_RELS) if r[0] == child and r[1] == fkcol and r[2] == parent)
        busY = BUS_TOP + bi * BUS_LANE
        x1 = cb.left
        dropX = x1 - 34 - (bi % 6) * 17
        p0 = (x1, y1)
        style = BUS_ENTRY.get((child, fkcol, parent), ("bottom",))

        if style[0] == "bottom":
            n = BUS_CNT[parent]
            s = BUS_SLOT.get(parent, 0)
            BUS_SLOT[parent] = s + 1
            entryX = pb.left + (s + 1) * pb.w / (n + 1)
            pB = (entryX, pb.bottom)
            pts = [p0, (dropX, y1), (dropX, busY), (entryX, busY), pB]
            apex = draw_crowsfoot(p0, pts[1], color)
            draw_poly([apex, pts[1], pts[2], pts[3], pB], color, dashed=dashed)
            draw_one_tick(pB, pts[3], color, double=(kind == "one2one"))
        elif style[0] == "pad":
            side = style[1]
            rx = pad_x(col_of(parent), side)
            pe = (pb.left, y2) if side == "left" else (pb.right, y2)
            pts = [p0, (dropX, y1), (dropX, busY), (rx, busY), (rx, y2), pe]
            apex = draw_crowsfoot(p0, pts[1], color)
            draw_poly([apex, pts[1], pts[2], pts[3], pts[4], pe], color, dashed=dashed)
            draw_one_tick(pe, pts[4], color, double=(kind == "one2one"))
        else:  # gapleft: riser in the gap left of parent column, staggered entry, no tick
            pi = col_of(parent)
            if pi == 0:
                rx = PANEL_XS[0] - 26  # left margin lane
            else:
                rx = (panel_right(pi - 1) + PANEL_XS[pi]) / 2 + 62
            ey = y2 + 12
            pe = (pb.left, ey)
            pts = [p0, (dropX, y1), (dropX, busY), (rx, busY), (rx, ey), pe]
            apex = draw_crowsfoot(p0, pts[1], color)
            draw_poly([apex, pts[1], pts[2], pts[3], pts[4], pe], color, dashed=dashed)
        continue

    # adjacent columns direct elbow
    if pb.cx > cb.cx:
        x1, x2 = cb.right, pb.left
    else:
        x1, x2 = cb.left, pb.right
    lane = (ri % 9) - 4
    midx = (x1 + x2) / 2 + lane * 13
    p0 = (x1, y1); p3 = (x2, y2)
    pts = [p0, (midx, y1), (midx, y2), p3]
    apex = draw_crowsfoot(p0, pts[1], color)
    draw_poly([apex, pts[1], pts[2], p3], color, dashed=dashed)
    draw_one_tick(p3, pts[2], color, double=(kind == "one2one"))

# Footer
fy = CANVAS_H - FOOTER_H - 6
d.line([(MARGIN, fy), (CANVAS_W - MARGIN, fy)], fill="#E2E8F0", width=2)
d.text((MARGIN, fy + 14), "Source: prisma/schema.prisma  (MySQL 8)  ·  All PKs are UUIDs  ·  Users.DEPID is a logical reference (no DB FK constraint)",
       font=F_FOOT, fill="#64748B")
r = "PRSYS · 2026-09-10"
d.text((CANVAS_W - MARGIN - tw(r, F_FOOT), fy + 14), r, font=F_FOOT, fill="#64748B")

img.save("/home/user/PRSYS/docs/erd/prsys-erd.png")
print(f"saved {img.size}")
