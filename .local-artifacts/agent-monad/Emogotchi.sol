// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice nad.fun DexRouter: buys a graduated token with native MON.
interface INadRouter {
    struct BuyParams {
        uint256 amountOutMin;
        address token;
        address to;
        uint256 deadline;
    }

    function buy(BuyParams calldata params) external payable returns (uint256 amountOut);
}

/// @notice nad.fun Lens: quotes with every fee included and names the router to use.
interface INadLens {
    function getAmountOut(address token, uint256 amountIn, bool isBuy)
        external
        view
        returns (address router, uint256 amountOut);
}

interface IERC20Balance {
    function balanceOf(address account) external view returns (uint256);
}

/// @notice The on-chain portraits (EmogotchiArt).
interface IEmogotchiArt {
    function image(uint8 mood, bool crowned) external view returns (string memory);
}

interface IERC721Receiver {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data)
        external
        returns (bytes4);
}

/**
 * @title Emogotchi
 * @notice A cat that lives in your wallet. An ERC-721 tamagotchi on Monad by Emonad ($EMO).
 *         Feed it, wash it, play with it, put it to bed; every interaction costs 1 MON and
 *         80% of it buys EMO and burns it. Everything about the cat is on chain.
 *
 *         No owner, no pause, no upgrade, no withdraw. The only privileged address is the
 *         MINTER, which can mint cats until MAX_SUPPLY is reached (the airdrop) and nothing
 *         else. Everything else is permissionless: anyone can crank the burn, sweep the
 *         treasury and team shares, or poke a cat so its record and metadata refresh.
 *
 *         Rules (all times wall clock):
 *         - Four meters, food / clean / fun / energy, 0..100, computed on read from timestamps.
 *           A care fills its meter to 100; it drains to 0 over 24 h.
 *         - A minted cat sits fresh, every meter full, until its first paid care or WELCOME
 *           after mint, whichever comes first. Then the clock runs.
 *         - Only hunger kills: 48 h after the last feed the cat is dead. Death is a computed
 *           fact; the first transaction that touches the cat afterwards records it.
 *         - Energy refills in 8 h asleep. At 0 energy the cat falls asleep by itself and wakes
 *           at 100 by itself, so an untouched cat cycles 24 h awake / 8 h asleep. A paid sleep
 *           puts it to bed early. Feeding, washing, playing with or cleaning up after a
 *           sleeping cat wakes it.
 *         - A poop appears 4 h after a meal; while it sits there cleanliness drains 2.5x faster.
 *           Cleaning it up is an action and gives +10 clean.
 *         - Petting is gas only; the first pet each UTC day gives +5 fun; every pet is counted.
 *         - Care score, 0..100: the average of the four meters over roughly the last SCORE_WINDOW,
 *           evaluated whenever it is read, so it climbs with care and decays by itself. A fresh
 *           cat starts at 0; a dead cat scores 0.
 *         - Crown: the CROWNS highest scores among cats with at least SCORE_WINDOW of history wear the
 *           crown, live. Every paid care re-ranks the cat; entering the list evicts the lowest, whose
 *           live score is refreshed first. Ties break on streak, then the incumbent keeps its place.
 *           Anyone can poke a cat to refresh its rank. A revived cat starts its week again.
 *         - Split of every 1 MON action and of naming: BURN_BPS accumulates for the buy-and-burn,
 *           TREASURY_BPS and TEAM_BPS accumulate for their addresses. A revive splits
 *           REVIVE_BURN_BPS to the burn and the rest to the team. Nothing a user sends depends
 *           on the swap: crankBurn() pushes accumulated MON through nad.fun, from anyone.
 *
 *         Direct transfer protocol: send exactly N.d MON to the contract, N = how many of your
 *         cats, d = the verb: .0 feed (hungriest first), .1 play (most bored first), .2 wash
 *         (dirtiest first), .3 sleep (most tired first, awake cats only), .4 clean up N poops.
 *         Exactly 1000.0 while holding a dead cat revives the longest-dead one. The 0.d tail
 *         goes to the treasury. Anything else reverts.
 */
contract Emogotchi {
    // ---------------------------------------------------------------- errors
    error NotMinter();
    error SoldOut();
    error ZeroAddress();
    error BadSplit();
    error NotOwner();
    error NotAlive();
    error Alive();
    error Asleep();
    error Awake();
    error NoPoop();
    error WrongValue(uint256 required, uint256 sent);
    error BadName();
    error BadCount();
    error BadAmount();
    error NotEnoughCats(uint256 eligible, uint256 requested);
    error Reentrancy();
    error NothingToDo();
    error Unauthorized();
    error InvalidToken();
    error UnsafeRecipient();
    error LengthMismatch();
    error BadAction();
    error BadGuard();

    // ---------------------------------------------------------------- events (ERC-721)
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    // ---------------------------------------------------------------- events (EIP-4906)
    event MetadataUpdate(uint256 _tokenId);
    event BatchMetadataUpdate(uint256 _fromTokenId, uint256 _toTokenId);
    // ---------------------------------------------------------------- events (game)
    /// @dev action: 0 feed, 1 play, 2 wash, 3 sleep, 4 clean, 5 wake, 6 name, 7 revive
    event Care(uint256 indexed id, uint8 indexed action, address indexed by, uint256 paid, uint256 timestamp);
    event Petted(uint256 indexed id, address indexed by, uint256 count, bool bonus);
    event Named(uint256 indexed id, string name);
    event Died(uint256 indexed id, uint256 at);
    event Revived(uint256 indexed id, address indexed by);
    event Score(uint256 indexed id, uint256 score, uint256 streak);
    event CrownWon(uint256 indexed id, uint256 score);
    event CrownLost(uint256 indexed id, uint256 score);
    event Burn(uint256 monIn, uint256 emoOut);
    event BurnQueued(uint256 monQueued, uint256 pendingTotal);
    event Swept(uint256 toTreasury, uint256 toTeam);
    event Skimmed(uint256 amount);

    // ---------------------------------------------------------------- constants
    uint256 public constant PRICE = 1 ether;
    uint256 public constant NAME_PRICE = 10 ether;
    uint256 public constant REVIVE_PRICE = 1000 ether;
    uint256 public constant DRAIN = 24 hours;
    uint256 public constant DEATH_AFTER = 48 hours;
    uint256 public constant REFILL = 8 hours;
    uint256 public constant CYCLE = DRAIN + REFILL;
    uint256 public constant POOP_AFTER = 4 hours;
    /// @dev cleanliness drains POOP_DIRT_NUM / POOP_DIRT_DEN times faster with a poop on the floor
    uint256 public constant POOP_DIRT_NUM = 5;
    uint256 public constant POOP_DIRT_DEN = 2;
    uint256 public constant CLEANUP_BONUS = 10;
    uint256 public constant PET_FUN = 5;
    uint256 public constant MAX_PETS = 20;
    uint256 public constant MAX_BATCH = 200;
    uint256 public constant NAME_BYTES = 32;
    uint256 public constant REVIVE_METER = 60;
    uint256 public constant SCORE_WINDOW = 7 days;
    uint256 public constant CROWNS = 100;
    uint256 private constant TENTH = 0.1 ether;
    uint256 private constant BPS = 10_000;
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    // ---------------------------------------------------------------- immutables
    address public immutable MINTER;
    uint256 public immutable MAX_SUPPLY;
    uint256 public immutable WELCOME;
    address public immutable TREASURY;
    address public immutable TEAM;
    uint256 public immutable BURN_BPS;
    uint256 public immutable TREASURY_BPS;
    uint256 public immutable TEAM_BPS;
    uint256 public immutable REVIVE_BURN_BPS;
    address public immutable EMO;
    address public immutable WMON;
    INadRouter public immutable ROUTER;
    INadLens public immutable LENS;
    address public immutable POOL;
    uint256 public immutable MAX_IMPACT_BPS;

    // ---------------------------------------------------------------- storage
    string public constant name = "Emogotchi";
    string public constant symbol = "EMOGOTCHI";
    /// @dev The portraits, composed on chain at read time.
    IEmogotchiArt public immutable ART;
    /// @dev Where the site lives; `animation_url` and `external_url` are `<siteURI>/pet/<id>`. Set once at deploy.
    string public siteURI;

    uint256 public totalSupply;
    mapping(uint256 => address) private _ownerOf;
    mapping(address => uint256[]) private _owned;
    mapping(uint256 => uint256) private _ownedIndex;
    mapping(uint256 => address) public getApproved;
    mapping(address => mapping(address => bool)) public isApprovedForAll;
    /// @dev One entry per mint call: (first id << 48) | timestamp. A cat's mint time is its batch's.
    uint256[] private _batches;

    /// @dev Slot A: timing. Slot B: counters. Slot C: money and score bookkeeping.
    struct Cat {
        // slot A
        uint40 lastFed; // 0 = fresh: refs are implied by the mint time and WELCOME
        uint40 lastWashed;
        uint40 lastPlayed;
        uint40 energyRef; // see _energyCalc(): the moment energy is/was 100 and the cat awake
        uint40 poopAt; // when the current poop appears/appeared; 0 = none scheduled
        uint40 deadAt; // 0 = not recorded dead
        uint16 streak;
        // slot B
        uint24 feeds;
        uint24 washes;
        uint24 plays;
        uint24 naps;
        uint24 cleanups;
        uint24 pets;
        uint16 names;
        uint16 deaths;
        uint16 revives;
        uint16 careScore; // 0..10000 as of scoreAt
        uint24 lastCareDay;
        uint24 lastPetDay;
        // slot C
        uint128 monPaid;
        uint40 bornAt; // when the clock started
        uint40 scoreAt; // last careScore update
        uint40 scoreFrom; // start of the score history (clock start, or the last revive)
    }

    mapping(uint256 => Cat) private _cats;
    mapping(uint256 => string) private _names;

    /// @dev Crown list. Entry: (id << 32) | (score << 16) | streak, 64 bits, four per storage slot so a
    ///      full rescan touches CROWNS / 4 slots (cold storage is dear on Monad). Index+1 per id in _crownIndex.
    uint256 private constant CROWN_SLOTS = CROWNS / 4;
    uint256 private constant ENTRY_MASK = 0xFFFFFFFFFFFFFFFF;
    uint256 private constant KEY_MASK = 0xFFFFFFFF;
    uint256[CROWN_SLOTS] private _crownSlots;
    uint256 private _crownLen;
    mapping(uint256 => uint256) private _crownIndex;
    uint256 private _crownMin; // index of the entry with the lowest (score, streak)

    uint256 public pendingBurnMon;
    uint128 public treasuryOwed;
    uint128 public teamOwed;
    uint256 public totalEmoBurned;
    uint256 public totalMonBurned;
    uint256 private _lock = 1;

    // ---------------------------------------------------------------- setup
    struct Params {
        address minter;
        uint256 maxSupply;
        uint256 welcome;
        address treasury;
        address team;
        uint256 burnBps;
        uint256 treasuryBps;
        uint256 teamBps;
        uint256 reviveBurnBps;
        address emo;
        address wmon;
        address router;
        address lens;
        address pool;
        uint256 maxImpactBps;
        address art;
        string siteURI;
    }

    constructor(Params memory p) {
        if (
            p.minter == address(0) || p.treasury == address(0) || p.team == address(0) || p.emo == address(0)
                || p.wmon == address(0) || p.router == address(0) || p.lens == address(0) || p.pool == address(0)
                || p.art == address(0)
        ) revert ZeroAddress();
        if (p.burnBps + p.treasuryBps + p.teamBps != BPS || p.reviveBurnBps > BPS) revert BadSplit();
        if (p.maxImpactBps == 0 || p.maxImpactBps > BPS) revert BadGuard();
        MINTER = p.minter;
        MAX_SUPPLY = p.maxSupply;
        WELCOME = p.welcome;
        TREASURY = p.treasury;
        TEAM = p.team;
        BURN_BPS = p.burnBps;
        TREASURY_BPS = p.treasuryBps;
        TEAM_BPS = p.teamBps;
        REVIVE_BURN_BPS = p.reviveBurnBps;
        EMO = p.emo;
        WMON = p.wmon;
        ROUTER = INadRouter(p.router);
        LENS = INadLens(p.lens);
        POOL = p.pool;
        MAX_IMPACT_BPS = p.maxImpactBps;
        ART = IEmogotchiArt(p.art);
        siteURI = p.siteURI;
    }

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    // ================================================================ minting (airdrop)

    /// @notice Mint one cat to each address. Minter only, capped by MAX_SUPPLY.
    function mint(address[] calldata to) external {
        if (msg.sender != MINTER) revert NotMinter();
        uint256 id = totalSupply;
        if (to.length == 0 || id + to.length > MAX_SUPPLY) revert SoldOut();
        _batches.push(((id + 1) << 48) | block.timestamp);
        for (uint256 i = 0; i < to.length; i++) {
            _mint(to[i], ++id);
        }
        totalSupply = id;
    }

    /// @notice Mint `count` cats to one address. Minter only, capped by MAX_SUPPLY.
    function mintMany(address to, uint256 count) external {
        if (msg.sender != MINTER) revert NotMinter();
        uint256 id = totalSupply;
        if (count == 0 || id + count > MAX_SUPPLY) revert SoldOut();
        _batches.push(((id + 1) << 48) | block.timestamp);
        for (uint256 i = 0; i < count; i++) {
            _mint(to, ++id);
        }
        totalSupply = id;
    }

    // ================================================================ paid care

    function feed(uint256 id) external payable {
        _paidCare(id, 0);
    }

    function play(uint256 id) external payable {
        _paidCare(id, 1);
    }

    function wash(uint256 id) external payable {
        _paidCare(id, 2);
    }

    function sleep(uint256 id) external payable {
        _paidCare(id, 3);
    }

    function clean(uint256 id) external payable {
        _paidCare(id, 4);
    }

    /// @notice Batch: one action per id, value = ids.length x PRICE. Actions: 0 feed, 1 play, 2 wash, 3 sleep, 4 clean.
    function care(uint256[] calldata ids, uint8[] calldata actions) external payable {
        if (ids.length != actions.length) revert LengthMismatch();
        if (ids.length == 0 || ids.length > MAX_BATCH) revert BadCount();
        uint256 required = ids.length * PRICE;
        if (msg.value != required) revert WrongValue(required, msg.value);
        _split(required);
        for (uint256 i = 0; i < ids.length; i++) {
            _care(ids[i], actions[i], PRICE);
        }
    }

    /// @notice Wake a sleeping cat. Free.
    function wake(uint256 id) external {
        Cat storage c = _cats[id];
        if (_ownerOf[id] != msg.sender) revert NotOwner();
        _sync(id, c);
        if (!_alive(id, c)) revert NotAlive();
        _materialize(id, c);
        (, bool asleep,) = _energyCalc(c.energyRef, block.timestamp);
        if (!asleep) revert Awake();
        _wake(c, block.timestamp);
        emit Care(id, 5, msg.sender, 0, block.timestamp);
        emit MetadataUpdate(id);
    }

    /// @notice Pet the cat, up to MAX_PETS times in one call. Gas only. The first pet each UTC day gives +PET_FUN fun.
    function pet(uint256 id, uint256 count) external {
        if (count == 0 || count > MAX_PETS) revert BadCount();
        Cat storage c = _cats[id];
        if (_ownerOf[id] != msg.sender) revert NotOwner();
        _sync(id, c);
        if (!_alive(id, c)) revert NotAlive();
        // a pet never starts the clock, but once the welcome is over the cat is live and the bonus applies
        if (c.lastFed == 0 && block.timestamp >= _mintedAt(id) + WELCOME) _materialize(id, c);
        c.pets += uint24(count);
        uint24 today = uint24(block.timestamp / 1 days);
        bool bonus;
        if (c.lastPetDay != today) {
            c.lastPetDay = today;
            bonus = true;
            if (c.lastFed != 0) {
                uint256 lp = uint256(c.lastPlayed) + (PET_FUN * DRAIN) / 100;
                c.lastPlayed = uint40(lp > block.timestamp ? block.timestamp : lp);
            }
        }
        emit Petted(id, msg.sender, count, bonus);
        emit MetadataUpdate(id);
    }

    /// @notice Name or rename the cat. 1..32 bytes. NAME_PRICE.
    function setName(uint256 id, string calldata newName) external payable {
        if (msg.value != NAME_PRICE) revert WrongValue(NAME_PRICE, msg.value);
        uint256 len = bytes(newName).length;
        if (len == 0 || len > NAME_BYTES) revert BadName();
        Cat storage c = _cats[id];
        if (_ownerOf[id] != msg.sender) revert NotOwner();
        _sync(id, c);
        if (!_alive(id, c)) revert NotAlive();
        _split(NAME_PRICE);
        c.names += 1;
        c.monPaid += uint128(NAME_PRICE);
        _names[id] = newName;
        emit Named(id, newName);
        emit Care(id, 6, msg.sender, NAME_PRICE, block.timestamp);
        emit MetadataUpdate(id);
    }

    /// @notice Bring a dead cat back with every meter at REVIVE_METER. REVIVE_PRICE.
    function revive(uint256 id) external payable {
        if (msg.value != REVIVE_PRICE) revert WrongValue(REVIVE_PRICE, msg.value);
        if (_ownerOf[id] != msg.sender) revert NotOwner();
        _splitRevive();
        _revive(id);
    }

    /// @notice Record anything that happened to the cat by itself (death), refresh its rank and metadata. Anyone.
    function poke(uint256 id) external {
        if (_ownerOf[id] == address(0)) revert InvalidToken();
        Cat storage c = _cats[id];
        _sync(id, c);
        if (c.lastFed != 0 && c.deadAt == 0) _rank(id, _scoreCalc(id, c, block.timestamp), c.streak);
        emit MetadataUpdate(id);
    }

    // ================================================================ direct transfer protocol

    receive() external payable nonReentrant {
        uint256 v = msg.value;
        if (v == 0 || v % TENTH != 0) revert BadAmount();
        uint256 n = v / 1 ether;
        uint256 d = (v % 1 ether) / TENTH;
        if (n == 0 || d > 4) revert BadAmount();

        if (n == 1000 && d == 0) {
            uint256 deadId = _longestDead(msg.sender);
            if (deadId != 0) {
                _splitRevive();
                _revive(deadId);
                return;
            }
        }
        if (n > MAX_BATCH) revert BadAmount();

        uint256[] memory ids = _select(msg.sender, uint8(d), n);
        _split(n * 1 ether);
        treasuryOwed += uint128(d * TENTH);
        for (uint256 i = 0; i < n; i++) {
            _care(ids[i], uint8(d), PRICE);
        }
    }

    // ================================================================ permissionless plumbing

    /// @notice Push accumulated burn MON through nad.fun, up to maxMon, under the impact guard. `minEmoOut`
    ///         is an optional floor from the caller (a quote taken in an earlier block); the swap uses the
    ///         higher of it and the contract's own guard, and a fill below it is queued, never lost.
    function crankBurn(uint256 maxMon, uint256 minEmoOut) external nonReentrant {
        uint256 amount = pendingBurnMon < maxMon ? pendingBurnMon : maxMon;
        if (amount == 0) revert NothingToDo();
        pendingBurnMon -= amount;
        _burn(amount, minEmoOut);
    }

    /// @notice MON that reached the contract outside the protocol (forced sends) joins the burn queue. Anyone.
    function skim() external nonReentrant {
        uint256 tracked = pendingBurnMon + treasuryOwed + teamOwed;
        uint256 excess = address(this).balance - tracked;
        if (excess == 0) revert NothingToDo();
        pendingBurnMon += excess;
        emit Skimmed(excess);
    }

    /// @notice Pay the treasury and the team what they are owed. Anyone. A share whose receiver refuses stays owed.
    function sweep() external nonReentrant {
        uint256 t = treasuryOwed;
        uint256 m = teamOwed;
        if (t == 0 && m == 0) revert NothingToDo();
        uint256 paidT;
        uint256 paidM;
        if (t > 0) {
            treasuryOwed = 0;
            (bool ok,) = TREASURY.call{value: t}("");
            if (ok) paidT = t;
            else treasuryOwed = uint128(t);
        }
        if (m > 0) {
            teamOwed = 0;
            (bool ok,) = TEAM.call{value: m}("");
            if (ok) paidM = m;
            else teamOwed = uint128(m);
        }
        if (paidT == 0 && paidM == 0) revert NothingToDo();
        emit Swept(paidT, paidM);
    }

    // ================================================================ views

    struct View {
        uint256 id;
        address owner;
        string name;
        bool started; // clock running (first care done or WELCOME over)
        bool alive;
        bool asleep;
        bool poop;
        bool crowned;
        bool crownEligible; // at least SCORE_WINDOW of history since the clock started or the last revive
        uint8 food;
        uint8 clean;
        uint8 fun;
        uint8 energy;
        uint8 mood; // index into moods()
        uint16 streak;
        uint16 score; // 0..10000, live
        uint256 day; // days since the clock started, 1-based; 0 while fresh
        uint40 mintedAt;
        uint40 startsAt; // when the clock starts by itself if nobody cares first
        uint40 bornAt;
        uint40 deadAt;
        uint40 poopAt;
        uint40 wakesAt; // when a sleeping cat wakes by itself; 0 if awake
        uint40 diesAt; // when the cat starves if nobody feeds it; 0 if dead
        uint24 feeds;
        uint24 washes;
        uint24 plays;
        uint24 naps;
        uint24 cleanups;
        uint24 pets;
        uint16 names;
        uint16 deaths;
        uint16 revives;
        uint128 monPaid;
    }

    /// @notice Everything about one cat, as of now.
    function state(uint256 id) public view returns (View memory v) {
        address o = _ownerOf[id];
        if (o == address(0)) revert InvalidToken();
        Cat memory c = _cats[id];
        uint256 now_ = block.timestamp;
        v.id = id;
        v.owner = o;
        v.name = _names[id];
        v.streak = c.streak;
        v.mintedAt = uint40(_mintedAt(id));
        v.startsAt = uint40(uint256(v.mintedAt) + WELCOME);
        v.feeds = c.feeds;
        v.washes = c.washes;
        v.plays = c.plays;
        v.naps = c.naps;
        v.cleanups = c.cleanups;
        v.pets = c.pets;
        v.names = c.names;
        v.deaths = c.deaths;
        v.revives = c.revives;
        v.monPaid = c.monPaid;
        if (c.lastFed == 0) {
            if (now_ < v.startsAt) {
                v.alive = true;
                v.food = 100;
                v.clean = 100;
                v.fun = 100;
                v.energy = 100;
                v.score = 0;
                v.mood = 1;
                return v;
            }
            _imply(c, v.startsAt);
        }
        v.started = true;
        v.bornAt = c.bornAt;
        uint256 dies = uint256(c.lastFed) + DEATH_AFTER;
        bool alive = c.deadAt == 0 && now_ < dies;
        uint256 t = alive ? now_ : (c.deadAt != 0 ? c.deadAt : dies);
        v.alive = alive;
        v.deadAt = alive ? 0 : uint40(t);
        v.diesAt = alive ? uint40(dies) : 0;
        if (!alive && c.deadAt == 0) v.deaths += 1; // computed but not yet recorded
        v.day = (t - c.bornAt) / 1 days + 1;
        (uint256 e, bool asleep, uint256 wakesAt) = _energyCalc(c.energyRef, t);
        v.food = uint8(_meter(c.lastFed, t));
        v.clean = uint8(_cleanCalc(c.lastWashed, c.poopAt, t));
        v.fun = uint8(_meter(c.lastPlayed, t));
        v.energy = uint8(e);
        v.asleep = alive && asleep;
        v.wakesAt = v.asleep ? uint40(wakesAt) : 0;
        v.poop = _poop(c.poopAt, t);
        v.poopAt = c.poopAt;
        v.score = alive ? uint16(_scoreFrom(c, t)) : 0;
        v.crownEligible = alive && now_ - c.scoreFrom >= SCORE_WINDOW;
        v.crowned = alive && _crownIndex[id] != 0;
        v.mood = _mood(v);
    }

    /// @notice Collection metadata (ERC-7572): name, description and a collection image, the crowned
    ///         happy cat, composed on chain like every portrait.
    function contractURI() external view returns (string memory) {
        string memory json = string.concat(
            '{"name":"Emogotchi","description":"A cat that lives in your wallet. Feed it, wash it, play with it, put it to bed; every interaction costs 1 MON and 80% of it buys EMO and burns it. Everything about the cat, its picture included, is on chain. By Emonad.",',
            '"image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(ART.image(1, true))),
            '","banner_image":"',
            siteURI,
            '/brand/opensea-banner.png","featured_image":"',
            siteURI,
            '/brand/opensea-featured.png","external_link":"',
            siteURI,
            '"}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    /// @notice The cat's portrait as it is now, plain SVG (the same picture tokenURI carries).
    function imageOf(uint256 id) external view returns (string memory) {
        View memory v = state(id);
        return ART.image(v.mood, v.crowned);
    }

    /// @notice Every cat an address holds, as of now.
    function catsOf(address owner) external view returns (View[] memory out) {
        uint256[] storage ids = _owned[owner];
        out = new View[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            out[i] = state(ids[i]);
        }
    }

    /// @notice Live care score, 0..10000.
    function scoreOf(uint256 id) external view returns (uint256) {
        if (_ownerOf[id] == address(0)) revert InvalidToken();
        return _scoreCalc(id, _cats[id], block.timestamp);
    }

    /// @notice The crown list: ids, live scores (0 for a cat that died since its last ranking), stored
    ///         streaks, and whether each cat is alive. Unordered. Entries only refresh on chain when the cat
    ///         is touched or poked; the live columns show what a poke would record.
    function crownList()
        external
        view
        returns (uint256[] memory ids, uint256[] memory scores, uint256[] memory streaks, bool[] memory alive)
    {
        uint256 n = _crownLen;
        ids = new uint256[](n);
        scores = new uint256[](n);
        streaks = new uint256[](n);
        alive = new bool[](n);
        for (uint256 i = 0; i < n; i++) {
            uint256 e = _entry(i);
            uint256 id = e >> 32;
            ids[i] = id;
            streaks[i] = e & 0xFFFF;
            alive[i] = _alive(id, _cats[id]);
            scores[i] = alive[i] ? _scoreCalc(id, _cats[id], block.timestamp) : 0;
        }
    }

    /// @notice A page of an address's cats, for holders too large for catsOf in one call.
    function catsOfRange(address owner, uint256 start, uint256 count) external view returns (View[] memory out) {
        uint256[] storage ids = _owned[owner];
        if (start >= ids.length) return out;
        uint256 end = start + count > ids.length ? ids.length : start + count;
        out = new View[](end - start);
        for (uint256 i = start; i < end; i++) {
            out[i - start] = state(ids[i]);
        }
    }

    function crowned(uint256 id) external view returns (bool) {
        if (_ownerOf[id] == address(0)) return false;
        return _crownIndex[id] != 0 && _alive(id, _cats[id]);
    }

    function tokensOfOwner(address owner) external view returns (uint256[] memory) {
        return _owned[owner];
    }

    function balanceOf(address owner) public view returns (uint256) {
        if (owner == address(0)) revert ZeroAddress();
        return _owned[owner].length;
    }

    function ownerOf(uint256 id) public view returns (address o) {
        o = _ownerOf[id];
        if (o == address(0)) revert InvalidToken();
    }

    function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256) {
        return _owned[owner][index];
    }

    function tokenByIndex(uint256 index) external view returns (uint256) {
        if (index >= totalSupply) revert InvalidToken();
        return index + 1;
    }

    function nameOf(uint256 id) external view returns (string memory) {
        return _names[id];
    }

    function mintedAt(uint256 id) external view returns (uint256) {
        if (_ownerOf[id] == address(0)) revert InvalidToken();
        return _mintedAt(id);
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7 // ERC-165
            || interfaceId == 0x80ac58cd // ERC-721
            || interfaceId == 0x5b5e139f // ERC-721 Metadata
            || interfaceId == 0x780e9d63 // ERC-721 Enumerable
            || interfaceId == 0x49064906; // EIP-4906
    }

    function moods() public pure returns (string[9] memory m) {
        m[0] = "content";
        m[1] = "happy";
        m[2] = "hungry";
        m[3] = "grubby";
        m[4] = "bored";
        m[5] = "sleepy";
        m[6] = "sleeping";
        m[7] = "sad";
        m[8] = "dead";
    }

    /// @notice On-chain metadata: JSON with the portrait composed from the cat's live state (an SVG data
    ///         URI) and the whole record as attributes. Nothing here depends on any server.
    function tokenURI(uint256 id) external view returns (string memory) {
        View memory v = state(id);
        string memory mood = moods()[v.mood];
        string memory idStr = _u(id);
        string memory displayName = bytes(v.name).length > 0 ? _escape(v.name) : string.concat("Emogotchi #", idStr);
        string memory json = string.concat(
            '{"name":"',
            displayName,
            '","description":"A cat that lives in your wallet. Feed it, wash it, play with it, put it to bed; every interaction costs 1 MON and 80% of it buys EMO and burns it. Everything about the cat is on chain.",',
            '"image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(ART.image(v.mood, v.crowned))),
            '","external_url":"',
            siteURI,
            "/pet/",
            idStr,
            '","animation_url":"',
            siteURI,
            "/pet/",
            idStr,
            '","attributes":[',
            _attributes(v, mood),
            "]}"
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    // ================================================================ ERC-721 transfers

    function approve(address spender, uint256 id) external {
        address owner = ownerOf(id);
        if (msg.sender != owner && !isApprovedForAll[owner][msg.sender]) revert Unauthorized();
        getApproved[id] = spender;
        emit Approval(owner, spender, id);
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function transferFrom(address from, address to, uint256 id) public {
        if (from != _ownerOf[id]) revert NotOwner();
        if (to == address(0)) revert ZeroAddress();
        if (msg.sender != from && !isApprovedForAll[from][msg.sender] && msg.sender != getApproved[id]) {
            revert Unauthorized();
        }
        _removeOwned(from, id);
        _addOwned(to, id);
        _ownerOf[id] = to;
        delete getApproved[id];
        emit Transfer(from, to, id);
    }

    function safeTransferFrom(address from, address to, uint256 id) external {
        transferFrom(from, to, id);
        _checkReceiver(from, to, id, "");
    }

    function safeTransferFrom(address from, address to, uint256 id, bytes calldata data) external {
        transferFrom(from, to, id);
        _checkReceiver(from, to, id, data);
    }

    // ================================================================ internals: care

    function _paidCare(uint256 id, uint8 action) private {
        if (msg.value != PRICE) revert WrongValue(PRICE, msg.value);
        _split(PRICE);
        _care(id, action, PRICE);
    }

    /// @dev Apply one paid action. The caller has already taken the payment into the split.
    function _care(uint256 id, uint8 action, uint256 paid) private {
        Cat storage c = _cats[id];
        if (_ownerOf[id] != msg.sender) revert NotOwner();
        _sync(id, c);
        if (!_alive(id, c)) revert NotAlive();
        uint256 now_ = block.timestamp;
        _materialize(id, c);
        c.careScore = uint16(_scoreFrom(c, now_));
        c.scoreAt = uint40(now_);
        if (action == 0) {
            c.lastFed = uint40(now_);
            c.feeds += 1;
            if (!_poop(c.poopAt, now_)) c.poopAt = uint40(now_ + POOP_AFTER);
        } else if (action == 1) {
            c.lastPlayed = uint40(now_);
            c.plays += 1;
        } else if (action == 2) {
            c.lastWashed = uint40(now_);
            c.washes += 1;
        } else if (action == 3) {
            (uint256 e, bool asleep,) = _energyCalc(c.energyRef, now_);
            if (asleep) revert Asleep();
            c.energyRef = uint40(now_ + ((100 - e) * REFILL) / 100);
            c.naps += 1;
        } else if (action == 4) {
            if (!_poop(c.poopAt, now_)) revert NoPoop();
            uint256 cur = _cleanCalc(c.lastWashed, c.poopAt, now_);
            uint256 next = cur + CLEANUP_BONUS > 100 ? 100 : cur + CLEANUP_BONUS;
            c.poopAt = 0;
            c.lastWashed = uint40(now_ - ((100 - next) * DRAIN) / 100);
            c.cleanups += 1;
        } else {
            revert BadAction();
        }
        if (action != 3) {
            // a sleeping cat is woken to be fed, played with, washed or cleaned up after
            (, bool asleep,) = _energyCalc(c.energyRef, now_);
            if (asleep) _wake(c, now_);
        }
        _streak(c, now_);
        c.monPaid += uint128(paid);
        _rank(id, c.careScore, c.streak);
        emit Care(id, action, msg.sender, paid, now_);
        emit MetadataUpdate(id);
    }

    function _revive(uint256 id) private {
        Cat storage c = _cats[id];
        _sync(id, c);
        if (_alive(id, c)) revert Alive();
        uint256 now_ = block.timestamp;
        uint40 ref = uint40(now_ - ((100 - REVIVE_METER) * DRAIN) / 100);
        c.lastFed = ref;
        c.lastWashed = ref;
        c.lastPlayed = ref;
        c.energyRef = ref;
        c.poopAt = 0;
        c.deadAt = 0;
        c.revives += 1;
        c.monPaid += uint128(REVIVE_PRICE);
        c.careScore = 0;
        c.scoreAt = uint40(now_);
        c.scoreFrom = uint40(now_);
        _streak(c, now_);
        _rank(id, c.careScore, c.streak);
        emit Revived(id, msg.sender);
        emit Care(id, 7, msg.sender, REVIVE_PRICE, now_);
        emit MetadataUpdate(id);
    }

    /// @dev A fresh cat gets explicit references: now if still in the welcome period, else the moment it ended.
    function _materialize(uint256 id, Cat storage c) private {
        if (c.lastFed != 0) return;
        uint256 start = _mintedAt(id) + WELCOME;
        uint40 base = uint40(block.timestamp < start ? block.timestamp : start);
        c.lastFed = base;
        c.lastWashed = base;
        c.lastPlayed = base;
        c.energyRef = base;
        c.bornAt = base;
        c.careScore = 0;
        c.scoreAt = base;
        c.scoreFrom = base;
    }

    /// @dev Same as _materialize for a memory copy whose clock started at `start`.
    function _imply(Cat memory c, uint256 start) private pure {
        c.lastFed = uint40(start);
        c.lastWashed = uint40(start);
        c.lastPlayed = uint40(start);
        c.energyRef = uint40(start);
        c.bornAt = uint40(start);
        c.careScore = 0;
        c.scoreAt = uint40(start);
        c.scoreFrom = uint40(start);
    }

    /// @dev Record a death that happened by itself. Idempotent.
    function _sync(uint256 id, Cat storage c) private {
        if (c.deadAt != 0) return;
        uint256 fed = c.lastFed;
        if (fed == 0) {
            uint256 start = _mintedAt(id) + WELCOME;
            if (block.timestamp < start + DEATH_AFTER) return;
            _materialize(id, c);
            fed = c.lastFed;
        }
        uint256 dies = fed + DEATH_AFTER;
        if (block.timestamp >= dies) {
            c.deadAt = uint40(dies);
            c.deaths += 1;
            c.streak = 0;
            _uncrown(id);
            emit Died(id, dies);
        }
    }

    function _alive(uint256 id, Cat storage c) private view returns (bool) {
        if (c.deadAt != 0) return false;
        uint256 fed = c.lastFed;
        if (fed == 0) fed = _mintedAt(id) + WELCOME;
        return block.timestamp < fed + DEATH_AFTER;
    }

    function _wake(Cat storage c, uint256 now_) private {
        (uint256 e,,) = _energyCalc(c.energyRef, now_);
        uint256 elapsed = ((100 - e) * DRAIN) / 100;
        if (elapsed >= DRAIN) elapsed = DRAIN - 1; // never wake straight back to sleep
        c.energyRef = uint40(now_ - elapsed);
    }

    function _streak(Cat storage c, uint256 now_) private {
        uint24 today = uint24(now_ / 1 days);
        if (c.lastCareDay == today && c.streak != 0) return;
        c.streak = c.lastCareDay + 1 == today ? c.streak + 1 : 1;
        c.lastCareDay = today;
    }

    function _split(uint256 amount) private {
        uint256 toTreasury = (amount * TREASURY_BPS) / BPS;
        uint256 toTeam = (amount * TEAM_BPS) / BPS;
        treasuryOwed += uint128(toTreasury);
        teamOwed += uint128(toTeam);
        pendingBurnMon += amount - toTreasury - toTeam;
    }

    function _splitRevive() private {
        uint256 toBurn = (REVIVE_PRICE * REVIVE_BURN_BPS) / BPS;
        pendingBurnMon += toBurn;
        teamOwed += uint128(REVIVE_PRICE - toBurn);
    }

    // ================================================================ internals: score and crown

    /// @dev Average of the four meters x100 at time t (the cat must be started and alive).
    function _avgMem(Cat memory c, uint256 t) private pure returns (uint256) {
        (uint256 e,,) = _energyCalc(c.energyRef, t);
        return (_meter(c.lastFed, t) + _cleanCalc(c.lastWashed, c.poopAt, t) + _meter(c.lastPlayed, t) + e) * 25;
    }

    uint256 private constant SCORE_SAMPLES = 8;

    /// @dev Score as of t for a started, alive cat: the stored score blended with the time-average of the
    ///      meters over [scoreAt, t] (midpoint rule, SCORE_SAMPLES slices; no care happened in between, so
    ///      the meters are a pure function of time). The blend window is the cat's score history, capped at
    ///      SCORE_WINDOW: a true running average for the first week, an exponential one after.
    function _scoreFrom(Cat memory c, uint256 t) private pure returns (uint256) {
        uint256 dt = t - c.scoreAt;
        if (dt == 0) return c.careScore;
        uint256 window = t - c.scoreFrom;
        if (window > SCORE_WINDOW) window = SCORE_WINDOW;
        uint256 w = dt > window ? window : dt;
        uint256 from = t - w; // only the last `window` of the interval can matter
        uint256 sum;
        for (uint256 i = 0; i < SCORE_SAMPLES; i++) {
            sum += _avgMem(c, from + (w * (2 * i + 1)) / (2 * SCORE_SAMPLES));
        }
        uint256 sample = sum / SCORE_SAMPLES;
        return (uint256(c.careScore) * (window - w) + sample * w) / window;
    }

    /// @dev Live score for any cat: 0 while fresh, 0 when dead.
    function _scoreCalc(uint256 id, Cat storage cs, uint256 t) private view returns (uint256) {
        Cat memory c = cs;
        if (c.lastFed == 0) {
            uint256 start = _mintedAt(id) + WELCOME;
            if (t < start) return 0;
            _imply(c, start);
        }
        if (c.deadAt != 0 || t >= uint256(c.lastFed) + DEATH_AFTER) return 0;
        return _scoreFrom(c, t);
    }

    function _key(uint256 score, uint256 streak) private pure returns (uint256) {
        return (score << 16) | streak;
    }

    function _entry(uint256 i) private view returns (uint256) {
        return (_crownSlots[i >> 2] >> ((i & 3) << 6)) & ENTRY_MASK;
    }

    function _setEntry(uint256 i, uint256 e) private {
        uint256 shift = (i & 3) << 6;
        uint256 slot = _crownSlots[i >> 2];
        _crownSlots[i >> 2] = (slot & ~(ENTRY_MASK << shift)) | (e << shift);
    }

    /// @dev Put the cat where its (score, streak) belongs in the crown list: update in place, enter if
    ///      there is room or it beats the lowest entry (whose live score is refreshed first), else nothing.
    ///      A zero score never holds a crown.
    function _rank(uint256 id, uint256 score, uint256 streak) private {
        emit Score(id, score, streak);
        if (score == 0 || block.timestamp - _cats[id].scoreFrom < SCORE_WINDOW) {
            _uncrown(id);
            return;
        }
        uint256 key = _key(score, streak);
        uint256 entry = (id << 32) | key;
        uint256 idx = _crownIndex[id];
        uint256 len = _crownLen;
        if (idx != 0) {
            idx -= 1;
            uint256 old = _entry(idx);
            _setEntry(idx, entry);
            if (idx == _crownMin) {
                if (key > (old & KEY_MASK)) _crownMin = _findMin();
            } else if (key < (_entry(_crownMin) & KEY_MASK)) {
                _crownMin = idx;
            }
            return;
        }
        if (len < CROWNS) {
            _setEntry(len, entry);
            _crownIndex[id] = len + 1;
            _crownLen = len + 1;
            if (len == 0 || key < (_entry(_crownMin) & KEY_MASK)) _crownMin = len;
            emit CrownWon(id, score);
            return;
        }
        uint256 minIdx = _crownMin;
        uint256 minEntry = _entry(minIdx);
        uint256 minId = minEntry >> 32;
        // self-heal: the lowest entry's stored score may be stale; refresh it before comparing
        uint256 liveMinKey = _key(_scoreCalc(minId, _cats[minId], block.timestamp), _cats[minId].streak);
        if (block.timestamp - _cats[minId].scoreFrom < SCORE_WINDOW) liveMinKey = 0; // revived since: not eligible
        if (liveMinKey < (minEntry & KEY_MASK)) {
            minEntry = (minId << 32) | liveMinKey;
            _setEntry(minIdx, minEntry);
        }
        if (key <= (minEntry & KEY_MASK)) return; // incumbent keeps a tie
        _setEntry(minIdx, entry);
        _crownIndex[id] = minIdx + 1;
        delete _crownIndex[minId];
        emit CrownLost(minId, (minEntry >> 16) & 0xFFFF);
        emit CrownWon(id, score);
        _crownMin = _findMin();
    }

    function _uncrown(uint256 id) private {
        uint256 idx = _crownIndex[id];
        if (idx == 0) return;
        idx -= 1;
        uint256 last = _crownLen - 1;
        uint256 score = (_entry(idx) >> 16) & 0xFFFF;
        if (idx != last) {
            uint256 moved = _entry(last);
            _setEntry(idx, moved);
            _crownIndex[moved >> 32] = idx + 1;
        }
        _setEntry(last, 0);
        _crownLen = last;
        delete _crownIndex[id];
        emit CrownLost(id, score);
        _crownMin = last == 0 ? 0 : _findMin();
    }

    function _findMin() private view returns (uint256 best) {
        uint256 len = _crownLen;
        uint256 bestKey = type(uint256).max;
        for (uint256 sIdx = 0; sIdx * 4 < len; sIdx++) {
            uint256 slot = _crownSlots[sIdx];
            for (uint256 lane = 0; lane < 4; lane++) {
                uint256 i = sIdx * 4 + lane;
                if (i >= len) break;
                uint256 k = (slot >> (lane << 6)) & KEY_MASK;
                if (k < bestKey) {
                    bestKey = k;
                    best = i;
                }
            }
        }
    }

    // ================================================================ internals: meters

    function _meter(uint256 since, uint256 t) private pure returns (uint256) {
        if (since >= t) return 100;
        uint256 elapsed = t - since;
        return elapsed >= DRAIN ? 0 : 100 - (elapsed * 100) / DRAIN;
    }

    function _poop(uint256 poopAt, uint256 t) private pure returns (bool) {
        return poopAt != 0 && t >= poopAt;
    }

    function _cleanCalc(uint256 washed, uint256 poopAt, uint256 t) private pure returns (uint256) {
        if (washed >= t) return 100;
        uint256 elapsed;
        if (poopAt != 0 && t >= poopAt) {
            uint256 p = poopAt > washed ? poopAt : washed;
            elapsed = (p - washed) + ((t - p) * POOP_DIRT_NUM) / POOP_DIRT_DEN;
        } else {
            elapsed = t - washed;
        }
        return elapsed >= DRAIN ? 0 : 100 - (elapsed * 100) / DRAIN;
    }

    /// @dev energyRef is the moment the cat is (or was) awake at 100 energy. Before it the cat is asleep
    ///      and filling (a paid nap); after it energy drains over DRAIN, then the cat sleeps REFILL by
    ///      itself and is back at 100: a CYCLE. Waking or napping early just moves the reference.
    function _energyCalc(uint256 ref, uint256 t) private pure returns (uint256 e, bool asleep, uint256 wakesAt) {
        if (t < ref) {
            uint256 left = ref - t;
            return (left >= REFILL ? 0 : 100 - (left * 100) / REFILL, true, ref);
        }
        uint256 phase = (t - ref) % CYCLE;
        if (phase < DRAIN) return (100 - (phase * 100) / DRAIN, false, 0);
        return (((phase - DRAIN) * 100) / REFILL, true, t + (CYCLE - phase));
    }

    function _mood(View memory v) private pure returns (uint8) {
        if (!v.alive) return 8;
        if (v.asleep) return 6;
        if (v.food < 20 || v.clean < 20 || v.fun < 20 || v.energy < 20) return 7;
        uint8 m = 0;
        uint256 low = 35;
        if (v.food < low) {
            m = 2;
            low = v.food;
        }
        if (v.clean < low) {
            m = 3;
            low = v.clean;
        }
        if (v.fun < low) {
            m = 4;
            low = v.fun;
        }
        if (v.energy < 30 && v.energy < low) {
            m = 5;
            low = v.energy;
        }
        if (m != 0) return m;
        if (v.poop) return 3;
        if (v.food > 78 && v.clean > 78 && v.fun > 78 && v.energy > 78) return 1;
        return 0;
    }

    // ================================================================ internals: mint time

    /// @dev Binary search over the batch table for the batch that contains `id`.
    function _mintedAt(uint256 id) private view returns (uint256) {
        uint256 lo = 0;
        uint256 hi = _batches.length; // > 0 for any minted id
        while (hi - lo > 1) {
            uint256 mid = (lo + hi) / 2;
            if ((_batches[mid] >> 48) <= id) lo = mid;
            else hi = mid;
        }
        return _batches[lo] & ((1 << 48) - 1);
    }

    // ================================================================ internals: protocol selection

    /// @dev The sender's cats eligible for `action`, the `n` most in need first. Reverts if fewer than n qualify.
    function _select(address owner, uint8 action, uint256 n) private view returns (uint256[] memory out) {
        uint256[] storage ids = _owned[owner];
        uint256 len = ids.length;
        uint256[] memory cand = new uint256[](len);
        uint256[] memory keys = new uint256[](len);
        uint256 m;
        uint256 now_ = block.timestamp;
        for (uint256 i = 0; i < len; i++) {
            uint256 id = ids[i];
            (bool ok, uint256 key) = _eligible(id, action, now_);
            if (ok) {
                cand[m] = id;
                keys[m] = key;
                m++;
            }
        }
        if (m < n) revert NotEnoughCats(m, n);
        out = new uint256[](n);
        for (uint256 j = 0; j < n; j++) {
            uint256 best = j;
            for (uint256 k = j + 1; k < m; k++) {
                if (keys[k] < keys[best]) best = k;
            }
            (cand[j], cand[best]) = (cand[best], cand[j]);
            (keys[j], keys[best]) = (keys[best], keys[j]);
            out[j] = cand[j];
        }
    }

    /// @dev Lower key = more in need. Fresh cats count as full and come last. Reads slot A only.
    function _eligible(uint256 id, uint8 action, uint256 now_) private view returns (bool ok, uint256 key) {
        Cat storage c = _cats[id];
        uint256 fed = c.lastFed;
        uint256 washed = c.lastWashed;
        uint256 played = c.lastPlayed;
        uint256 eref = c.energyRef;
        uint256 poopAt = c.poopAt;
        if (fed == 0) {
            uint256 start = _mintedAt(id) + WELCOME;
            if (now_ < start) return (action != 4, 101);
            fed = start;
            washed = start;
            played = start;
            eref = start;
            poopAt = 0;
        }
        if (c.deadAt != 0 || now_ >= fed + DEATH_AFTER) return (false, 0);
        if (action == 0) return (true, _meter(fed, now_));
        if (action == 1) return (true, _meter(played, now_));
        if (action == 2) return (true, _cleanCalc(washed, poopAt, now_));
        if (action == 3) {
            (uint256 e, bool asleep,) = _energyCalc(eref, now_);
            return (!asleep, e);
        }
        return (_poop(poopAt, now_), 0);
    }

    /// @dev The sender's dead cat that has been dead the longest, or 0.
    function _longestDead(address owner) private view returns (uint256 best) {
        uint256[] storage ids = _owned[owner];
        uint256 bestAt = type(uint256).max;
        uint256 now_ = block.timestamp;
        for (uint256 i = 0; i < ids.length; i++) {
            uint256 id = ids[i];
            Cat storage c = _cats[id];
            uint256 fed = c.lastFed;
            if (fed == 0) fed = _mintedAt(id) + WELCOME;
            uint256 at = c.deadAt != 0 ? c.deadAt : fed + DEATH_AFTER;
            if (now_ >= at && at < bestAt) {
                bestAt = at;
                best = id;
            }
        }
    }

    // ================================================================ internals: burn (Cat's Crown pattern)

    /// @dev Buy EMO with `monIn` through nad.fun and send it to the burn address. Amounts above the
    ///      impact guard, a lens that names another router, and any router failure are queued instead
    ///      of lost. Returns EMO burned.
    function _burn(uint256 monIn, uint256 minEmoOut) private returns (uint256 emoOut) {
        uint256 depth;
        try IERC20Balance(WMON).balanceOf(POOL) returns (uint256 d) {
            depth = d;
        } catch {
            depth = 0;
        }
        uint256 maxIn = (depth * MAX_IMPACT_BPS) / BPS;
        if (depth == 0 || monIn > maxIn) return _queue(monIn);

        (address router, uint256 quoted) = _safeQuote(monIn);
        if (router != address(ROUTER) || quoted == 0) return _queue(monIn);
        uint256 minOut = (quoted * (BPS - MAX_IMPACT_BPS)) / BPS;
        if (minEmoOut > minOut) minOut = minEmoOut;

        try ROUTER.buy{value: monIn}(
            INadRouter.BuyParams({amountOutMin: minOut, token: EMO, to: BURN_ADDRESS, deadline: block.timestamp})
        ) returns (uint256 amountOut) {
            emoOut = amountOut;
            totalEmoBurned += emoOut;
            totalMonBurned += monIn;
            emit Burn(monIn, emoOut);
        } catch {
            return _queue(monIn);
        }
    }

    function _queue(uint256 monIn) private returns (uint256) {
        pendingBurnMon += monIn;
        emit BurnQueued(monIn, pendingBurnMon);
        return 0;
    }

    function _safeQuote(uint256 monIn) private view returns (address router, uint256 amountOut) {
        try LENS.getAmountOut(EMO, monIn, true) returns (address r, uint256 out) {
            return (r, out);
        } catch {
            return (address(0), 0);
        }
    }

    // ================================================================ internals: ERC-721

    function _mint(address to, uint256 id) private {
        if (to == address(0)) revert ZeroAddress();
        _ownerOf[id] = to;
        _addOwned(to, id);
        emit Transfer(address(0), to, id);
    }

    function _addOwned(address to, uint256 id) private {
        _ownedIndex[id] = _owned[to].length;
        _owned[to].push(id);
    }

    function _removeOwned(address from, uint256 id) private {
        uint256[] storage list = _owned[from];
        uint256 idx = _ownedIndex[id];
        uint256 last = list.length - 1;
        if (idx != last) {
            uint256 moved = list[last];
            list[idx] = moved;
            _ownedIndex[moved] = idx;
        }
        list.pop();
        delete _ownedIndex[id];
    }

    function _checkReceiver(address from, address to, uint256 id, bytes memory data) private {
        if (to.code.length == 0) return;
        try IERC721Receiver(to).onERC721Received(msg.sender, from, id, data) returns (bytes4 sel) {
            if (sel != IERC721Receiver.onERC721Received.selector) revert UnsafeRecipient();
        } catch {
            revert UnsafeRecipient();
        }
    }

    // ================================================================ internals: metadata

    function _attributes(View memory v, string memory mood) private pure returns (string memory) {
        string memory a = string.concat(
            _num("Food", v.food),
            ",",
            _num("Clean", v.clean),
            ",",
            _num("Fun", v.fun),
            ",",
            _num("Energy", v.energy),
            ",",
            _str("Mood", mood),
            ",",
            _str("Alive", v.alive ? "yes" : "no"),
            ",",
            _str("Asleep", v.asleep ? "yes" : "no"),
            ",",
            _str("Poop", v.poop ? "yes" : "no"),
            ",",
            _str("Crown", v.crowned ? "yes" : "no")
        );
        string memory b = string.concat(
            _num("Day", v.day),
            ",",
            _num("Streak", v.streak),
            ",",
            _num("Care score", v.score / 100),
            ",",
            _num("Feeds", v.feeds),
            ",",
            _num("Washes", v.washes),
            ",",
            _num("Plays", v.plays),
            ",",
            _num("Naps", v.naps),
            ",",
            _num("Cleanups", v.cleanups)
        );
        string memory c = string.concat(
            _num("Pets", v.pets),
            ",",
            _num("Names", v.names),
            ",",
            _num("Deaths", v.deaths),
            ",",
            _num("Revives", v.revives),
            ",",
            _num("MON spent", uint256(v.monPaid) / 1 ether)
        );
        return string.concat(a, ",", b, ",", c);
    }

    function _num(string memory trait, uint256 value) private pure returns (string memory) {
        return string.concat('{"trait_type":"', trait, '","value":', _u(value), "}");
    }

    function _str(string memory trait, string memory value) private pure returns (string memory) {
        return string.concat('{"trait_type":"', trait, '","value":"', value, '"}');
    }

    function _u(uint256 v) private pure returns (string memory) {
        if (v == 0) return "0";
        uint256 j = v;
        uint256 len;
        while (j != 0) {
            len++;
            j /= 10;
        }
        bytes memory b = new bytes(len);
        while (v != 0) {
            b[--len] = bytes1(uint8(48 + (v % 10)));
            v /= 10;
        }
        return string(b);
    }

    /// @dev JSON-escape a name: quotes, backslashes and control characters.
    function _escape(string memory s) private pure returns (string memory) {
        bytes memory b = bytes(s);
        bytes memory out = new bytes(b.length * 6);
        uint256 n;
        for (uint256 i = 0; i < b.length; i++) {
            bytes1 ch = b[i];
            if (ch == '"' || ch == "\\") {
                out[n++] = "\\";
                out[n++] = ch;
            } else if (uint8(ch) < 0x20) {
                out[n++] = "\\";
                out[n++] = "u";
                out[n++] = "0";
                out[n++] = "0";
                out[n++] = bytes1(uint8(ch) >> 4 < 10 ? 48 + (uint8(ch) >> 4) : 87 + (uint8(ch) >> 4));
                out[n++] = bytes1((uint8(ch) & 15) < 10 ? 48 + (uint8(ch) & 15) : 87 + (uint8(ch) & 15));
            } else {
                out[n++] = ch;
            }
        }
        assembly {
            mstore(out, n)
        }
        return string(out);
    }
}

/// @dev Base64 encoder (OpenZeppelin's, MIT), with the tail masked so bytes past the input never leak in.
library Base64 {
    string internal constant _TABLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    function encode(bytes memory data) internal pure returns (string memory) {
        if (data.length == 0) return "";
        string memory table = _TABLE;
        string memory result = new string(4 * ((data.length + 2) / 3));
        assembly {
            let tablePtr := add(table, 1)
            let resultPtr := add(result, 32)
            let end := add(data, mload(data))
            for { let dataPtr := data } lt(dataPtr, end) {} {
                dataPtr := add(dataPtr, 3)
                let input := mload(dataPtr)
                // the last group may reach past the data: its missing bytes are the lowest ones, zero them
                if gt(dataPtr, end) { input := and(input, not(sub(shl(mul(8, sub(dataPtr, end)), 1), 1))) }
                mstore8(resultPtr, mload(add(tablePtr, and(shr(18, input), 0x3F))))
                resultPtr := add(resultPtr, 1)
                mstore8(resultPtr, mload(add(tablePtr, and(shr(12, input), 0x3F))))
                resultPtr := add(resultPtr, 1)
                mstore8(resultPtr, mload(add(tablePtr, and(shr(6, input), 0x3F))))
                resultPtr := add(resultPtr, 1)
                mstore8(resultPtr, mload(add(tablePtr, and(input, 0x3F))))
                resultPtr := add(resultPtr, 1)
            }
            switch mod(mload(data), 3)
            case 1 {
                mstore8(sub(resultPtr, 1), 0x3d)
                mstore8(sub(resultPtr, 2), 0x3d)
            }
            case 2 { mstore8(sub(resultPtr, 1), 0x3d) }
        }
        return result;
    }
}
